import { generateSplits, movedPlayers, type Candidate } from "../core/balance.js";
import { effectiveStrength, mean, missingPlayers, onCourt } from "../core/rating.js";
import { starString } from "../core/stars.js";
import type { Db, Player, PlayerId, Session, Standings } from "../core/types.js";
import { replay } from "../core/replay.js";
import type { Avatars, SaveOutcome } from "../storage/github.js";
import { runConflictCheck, runWriteCheck, type CheckResult } from "../storage/selfcheck.js";
import type { Store } from "../storage/store.js";
import { avatarHtml } from "./avatar.js";
import { button, el, text } from "./dom.js";
import {
  addPlayers,
  parseRoster,
  removePlayer,
  renamePlayer,
  seedStarsOf,
  setPlayerActive,
  setSeedStars,
  setsPlayedBy,
} from "./roster.js";
import {
  appendLineup,
  closeSession,
  currentLineupOf,
  deleteLastSet,
  openSessionOf,
  PLAYERS_ON_COURT,
  recordSet,
  replaceCurrentLineup,
  setAttendance,
  setsForLineup,
  startSession,
} from "./session.js";

/**
 * Variant C, as settled on #5: the screen is the court, with tabs.
 *
 * Exact ratings are never rendered for a player — the organizer sees a balance
 * gap and rating moves, and the per-player display is stars only. That is a
 * product invariant (CLAUDE.md), not a display preference.
 */

interface UiState {
  tab: "court" | "pool" | "tonight";
  /** Player management sits outside the session tabs. */
  view: "session" | "players" | "add-players";
  /** The player whose detail panel is open, if any. */
  editing: PlayerId | null;
  /** Starting stars chosen for a pending paste. */
  pasteStars: number;
  pasteText: string;
  query: string;
  draft: { a: number; b: number };
  /** Attendance is picked locally, then committed in one write. */
  picking: Set<PlayerId> | null;
  shortlist: Candidate[];
  shortlistIndex: number;
  busy: string | null;
  error: string | null;
  /** Set after ending a session, so the summary can be shown once. */
  endedSessionId: string | null;
}

export interface MountOptions {
  root: HTMLElement;
  store: Store;
  avatars: Avatars;
  token: string;
  onForgetToken: () => void;
}

export function mountApp({ root, store, avatars, token, onForgetToken }: MountOptions): void {
  const ui: UiState = {
    tab: "court",
    view: "session",
    editing: null,
    pasteStars: 3,
    pasteText: "",
    query: "",
    draft: { a: 25, b: 20 },
    picking: null,
    shortlist: [],
    shortlistIndex: 0,
    busy: null,
    error: null,
    endedSessionId: null,
  };

  const playerById = (db: Db): Map<PlayerId, Player> => new Map(db.players.map((p) => [p.id, p]));
  const nameOf = (db: Db, id: PlayerId): string => playerById(db).get(id)?.name ?? id;

  /** Run a write, keeping the screen honest about what is actually stored. */
  const commit = async (label: string, mutate: (draft: Db) => void, message: string): Promise<boolean> => {
    ui.busy = label;
    ui.error = null;
    render();
    let outcome: SaveOutcome;
    try {
      outcome = await store.commit(mutate, message);
    } catch (error) {
      ui.busy = null;
      ui.error = error instanceof Error ? error.message : "Something went wrong.";
      render();
      return false;
    }
    ui.busy = null;
    ui.error = outcome.ok ? null : outcome.message;
    render();
    return outcome.ok;
  };

  const splitsFor = (attendees: PlayerId[], standings: Standings, current?: { sideA: PlayerId[] }) =>
    generateSplits({
      attendees,
      standings,
      playersOnCourt: PLAYERS_ON_COURT,
      pastSessions: store.snapshot().sessions.filter((s) => s.closedAt !== null),
      ...(current ? { currentLineup: current } : {}),
    });

  // ---------------------------------------------------------------- chrome

  const banner = (): HTMLElement | null => {
    if (ui.busy !== null) return el(`<div class="banner">${text(ui.busy)}…</div>`);
    if (ui.error !== null) return el(`<div class="banner bad"><strong>${text(ui.error)}</strong></div>`);
    return null;
  };

  const header = (session: Session | undefined): HTMLElement => {
    const head = el<HTMLElement>(`<div class="shead">
        <span class="t">${session ? text(session.label) : "teambalance"}</span>
        ${session ? `<span class="live">session open</span>` : ""}
      </div>`);
    if (session) {
      head.append(
        button(`<button>End session</button>`, () => {
          void (async () => {
            const id = session.id;
            if (await commit("Ending the session", closeSession(), `Close session ${session.label}`)) {
              ui.endedSessionId = id;
              render();
            }
          })();
        }),
      );
    }
    return head;
  };

  const tabs = (session: Session): HTMLElement => {
    const bar = el<HTMLElement>(`<div class="tabs" role="tablist"></div>`);
    const items: Array<[UiState["tab"], string]> = [
      ["court", "Court"],
      ["pool", "Pool"],
      ["tonight", session.sets.length > 0 ? `Tonight (${String(session.sets.length)})` : "Tonight"],
    ];
    for (const [key, label] of items) {
      bar.append(
        button(`<button role="tab" aria-selected="${String(ui.tab === key)}">${label}</button>`, () => {
          ui.tab = key;
          ui.query = "";
          render();
        }),
      );
    }
    return bar;
  };

  const searchField = (): HTMLElement => {
    const wrap = el<HTMLElement>(`<label class="search">
        <span aria-hidden="true" style="color:var(--ink-3)">&#8981;</span>
        <input type="search" placeholder="Search players" value="${text(ui.query)}" aria-label="Search players" />
      </label>`);
    const input = wrap.querySelector("input") as HTMLInputElement;
    input.addEventListener("input", () => {
      ui.query = input.value;
      render({ refocusSearch: true });
    });
    return wrap;
  };

  const matches = (player: Player): boolean => {
    const q = ui.query.trim().toLowerCase();
    return q.length === 0 || player.name.toLowerCase().includes(q);
  };

  // ------------------------------------------------------------- screens

  const screenIdle = (db: Db): HTMLElement => {
    const { screen, pad } = shell();
    pad.append(
      el(`<div><div class="eyebrow">teambalance</div><h1>No session running</h1></div>`),
      el(`<p class="muted" style="margin:0">Starting a session opens the evening. Ending it is what
          moves everyone's stars.</p>`),
      el(`<div class="statline"><span class="big num">${String(db.players.length)}</span>
          <span class="muted">players in the pool<br /><span class="eyebrow">${
            db.sessions.length > 0 ? `${String(db.sessions.length)} sessions recorded` : "no sessions yet"
          }</span></span></div>`),
    );

    if (db.players.length < 4) {
      pad.append(
        el(`<div class="notice">The pool needs at least four players before a session can start.</div>`),
        button(`<button class="cta">Add players</button>`, () => {
          ui.view = "add-players";
          ui.pasteText = "";
          render();
        }),
      );
      pad.append(tools());
      return screen;
    }

    pad.append(
      button(`<button class="cta">Start a session</button>`, () => {
        ui.picking = new Set(db.players.filter((p) => p.active).map((p) => p.id));
        ui.query = "";
        render();
      }),
    );
    pad.append(
      button(`<button class="cta ghost">Manage players</button>`, () => {
        ui.view = "players";
        ui.query = "";
        render();
      }),
    );
    pad.append(tools());
    return screen;
  };

  /**
   * Kept out of the way but kept: the Saturday dry run (#16) needs to prove
   * persistence and the no-token path on the actual phone.
   */
  const tools = (): HTMLElement => {
    const box = el<HTMLElement>(`<details class="tools"><summary>Storage check</summary></details>`);
    const result = el<HTMLElement>(`<div></div>`);
    const run = (label: string, check: () => Promise<CheckResult>, btn: HTMLButtonElement) => {
      btn.disabled = true;
      result.replaceChildren(el(`<div class="muted">${label}…</div>`));
      void check()
        .then((outcome) => {
          result.replaceChildren(
            el(`<div class="notice ${outcome.ok ? "ok" : ""}"><strong>${text(outcome.headline)}</strong><br />
                <span class="muted">${text(outcome.detail)}</span></div>`),
          );
        })
        .catch((error: unknown) => {
          result.replaceChildren(
            el(`<div class="notice"><strong>Check failed</strong><br /><span class="muted">${text(
              error instanceof Error ? error.message : "Something went wrong.",
            )}</span></div>`),
          );
        })
        .finally(() => {
          btn.disabled = false;
        });
    };

    const writeBtn = el<HTMLButtonElement>(`<button class="cta ghost">Write and read back</button>`);
    writeBtn.addEventListener("click", () => run("Writing", () => runWriteCheck(token), writeBtn));
    const conflictBtn = el<HTMLButtonElement>(`<button class="cta ghost">Force a stale write</button>`);
    conflictBtn.addEventListener("click", () => run("Sending a stale write", () => runConflictCheck(token), conflictBtn));

    box.append(
      el(`<p class="muted" style="margin:0;font-size:var(--step--1)">Writes to a scratch file, never your real data.</p>`),
      writeBtn,
      conflictBtn,
      result,
      button(`<button class="cta ghost">Forget this token</button>`, onForgetToken),
    );
    return box;
  };

  const screenAttendance = (db: Db, standings: Standings): HTMLElement => {
    const picking = ui.picking as Set<PlayerId>;
    const { screen } = shell();
    screen.replaceChildren();
    screen.append(header(undefined));

    const scroll = el<HTMLElement>(`<div class="scroll"><div class="pad"></div></div>`);
    const pad = scroll.firstElementChild as HTMLElement;
    const here = picking.size;

    pad.append(
      el(`<div><h1>Who turned up?</h1>
          <div class="muted" style="font-size:var(--step--1)">Set this once now. Late arrivals go in from the Pool tab.</div></div>`),
      searchField(),
      el(`<div class="eyebrow">${String(here)} here · ${
        here % 2 === 0 ? "even sides" : "odd, so one side plays a player down"
      }</div>`),
    );

    for (const player of db.players.filter(matches)) {
      const on = picking.has(player.id);
      pad.append(
        button(
          `<button class="prow" aria-pressed="${String(on)}">
            ${avatarHtml(player, avatars)}
            <span><span class="nm">${text(player.name)}</span><br />
              <span class="stars">${starString(standings.get(player.id)?.stars ?? 3)}</span></span>
            <span class="rt">${on ? "here" : ""}</span>
          </button>`,
          () => {
            if (on) picking.delete(player.id);
            else picking.add(player.id);
            render();
          },
        ),
      );
    }

    screen.append(scroll);

    const foot = el<HTMLElement>(`<div class="sticky"></div>`);
    foot.append(
      button(
        `<button class="cta" ${here < 4 ? "disabled" : ""}>Make the teams · ${String(here)} here</button>`,
        () => {
          void (async () => {
            const attendees = [...picking];
            const { shortlist } = splitsFor(attendees, standings);
            const best = shortlist[0];
            if (!best) {
              ui.error = "Could not make teams from that many players.";
              render();
              return;
            }
            ui.shortlist = shortlist;
            ui.shortlistIndex = 0;
            if (await commit("Starting the session", startSession(attendees, best), "Start session")) {
              ui.picking = null;
              ui.tab = "court";
              render();
            }
          })();
        },
      ),
      button(`<button class="cta ghost">Cancel</button>`, () => {
        ui.picking = null;
        render();
      }),
    );
    screen.append(foot);
    return screen;
  };

  const half = (
    db: Db,
    label: string,
    side: PlayerId[],
    other: PlayerId[],
    session: Session,
    moved: PlayerId[],
    cls: string,
  ): HTMLElement => {
    const ownCourt = onCourt(side.length, session.playersOnCourt);
    const otherCourt = onCourt(other.length, session.playersOnCourt);
    const short = missingPlayers(ownCourt, otherCourt) > 0;
    const note = short
      ? `<span class="short-badge">a player down</span>`
      : `${String(ownCourt)} v ${String(otherCourt)}${side.length > ownCourt ? " · rotating" : ""}`;
    return el(`<div class="half ${cls}">
        <div class="label"><span>${label}</span><span>${note}</span></div>
        <ul>${side
          .map(
            (id) =>
              `<li>${text(nameOf(db, id))}${moved.includes(id) ? ' <span class="moved">moved</span>' : ""}</li>`,
          )
          .join("")}</ul>
      </div>`);
  };

  const tabCourt = (db: Db, session: Session, standings: Standings): HTMLElement => {
    const lineup = currentLineupOf(session);
    const wrap = el<HTMLElement>(`<div class="flexcol"></div>`);
    if (!lineup) return wrap;

    const played = setsForLineup(session, lineup.seq).length;
    const previous = session.lineups[session.lineups.length - 2];
    const moved = previous ? movedPlayers(previous, { sideA: lineup.sideA }, session.attendees) : [];

    const ratingsOf = (side: PlayerId[]) => side.map((id) => standings.get(id)?.rating ?? 1500);
    const strength = (side: PlayerId[], other: PlayerId[]) =>
      effectiveStrength(
        mean(ratingsOf(side)),
        missingPlayers(onCourt(side.length, session.playersOnCourt), onCourt(other.length, session.playersOnCourt)),
      );
    const gap = Math.abs(strength(lineup.sideA, lineup.sideB) - strength(lineup.sideB, lineup.sideA));

    const court = el<HTMLElement>(`<div class="court"></div>`);
    court.append(half(db, "Gold", lineup.sideA, lineup.sideB, session, moved, "side-gold"));
    court.append(
      el(`<div class="net">
          <span class="sc">${String(ui.draft.a)} &ndash; ${String(ui.draft.b)}</span>
          <span class="meta">teams ${String(lineup.seq)} · gap ${gap.toFixed(0)} pts<br />
            ${String(played)} ${played === 1 ? "set" : "sets"} on these teams</span>
        </div>`),
    );
    court.append(half(db, "Navy", lineup.sideB, lineup.sideA, session, moved, "side-navy"));
    wrap.append(court);

    const sheet = el<HTMLElement>(`<div class="sheet"></div>`);
    const big = el<HTMLElement>(`<div class="bigscore"></div>`);
    const column = (key: "a" | "b", label: string): HTMLElement => {
      const col = el<HTMLElement>(`<div>
          <div class="eyebrow" style="text-align:center">${label}</div>
          <div class="n">${String(ui.draft[key])}</div>
          <div class="ctrls"></div>
        </div>`);
      const ctrls = col.querySelector(".ctrls") as HTMLElement;
      ctrls.append(
        button(`<button aria-label="one fewer point for ${label}">&minus;</button>`, () => {
          ui.draft[key] = Math.max(0, ui.draft[key] - 1);
          render();
        }),
        button(`<button aria-label="one more point for ${label}">+</button>`, () => {
          ui.draft[key] += 1;
          render();
        }),
      );
      return col;
    };
    big.append(column("a", "Gold"), el(`<div class="muted num" style="align-self:center">&ndash;</div>`), column("b", "Navy"));
    sheet.append(big);

    const row = el<HTMLElement>(`<div class="row"></div>`);
    // Shuffle and rebalance answer different moments, so only one is ever
    // offered: the pair side by side read as the same button (#5).
    if (played === 0) {
      row.append(
        button(`<button>Try another split</button>`, () => {
          void (async () => {
            if (ui.shortlist.length === 0) ui.shortlist = splitsFor(session.attendees, standings).shortlist;
            if (ui.shortlist.length < 2) {
              ui.error = "No equally fair alternative exists for this group.";
              render();
              return;
            }
            ui.shortlistIndex = (ui.shortlistIndex + 1) % ui.shortlist.length;
            const next = ui.shortlist[ui.shortlistIndex] as Candidate;
            await commit("Swapping the split", replaceCurrentLineup(next.sideA, next.sideB), "Try another split");
          })();
        }),
      );
    } else {
      row.append(
        button(`<button>Rebalance</button>`, () => {
          void (async () => {
            const { shortlist } = splitsFor(session.attendees, standings, { sideA: lineup.sideA });
            const next = shortlist[0];
            if (!next) {
              ui.error = "No different split is possible for this group.";
              render();
              return;
            }
            ui.shortlist = shortlist;
            ui.shortlistIndex = 0;
            const who = movedPlayers({ sideA: lineup.sideA }, next, session.attendees)
              .map((id) => nameOf(db, id))
              .join(" and ");
            await commit("Rebalancing", appendLineup(next.sideA, next.sideB, `swapped ${who}`), "Rebalance teams");
          })();
        }),
      );
    }
    row.append(
      button(`<button class="primary">Save set</button>`, () => {
        void (async () => {
          if (ui.draft.a === ui.draft.b) {
            ui.error = "A set cannot be a draw.";
            render();
            return;
          }
          if (await commit("Saving the set", recordSet(ui.draft.a, ui.draft.b), `Set ${String(ui.draft.a)}-${String(ui.draft.b)}`)) {
            ui.draft = { a: 25, b: 20 };
            render();
          }
        })();
      }),
    );
    sheet.append(row);
    sheet.append(
      el(`<div class="hint">${
        played === 0
          ? "Same ratings, a different split — every option is within 15 pts of fairest."
          : "New teams from ratings as they are now, moving at least two players."
      }</div>`),
    );
    wrap.append(sheet);
    return wrap;
  };

  const tabPool = (db: Db, session: Session, standings: Standings): HTMLElement => {
    const scroll = el<HTMLElement>(`<div class="scroll"><div class="pad"></div></div>`);
    const pad = scroll.firstElementChild as HTMLElement;
    pad.append(searchField(), el(`<div class="eyebrow">Tap to add a late arrival or remove someone who left</div>`));

    for (const player of db.players.filter(matches)) {
      const here = session.attendees.includes(player.id);
      const standing = standings.get(player.id);
      pad.append(
        button(
          `<button class="prow" aria-pressed="${String(here)}">
            ${avatarHtml(player, avatars)}
            <span><span class="nm">${text(player.name)}</span><br />
              <span class="stars">${starString(standing?.stars ?? 3)}</span></span>
            <span class="rt">${String(standing?.setsPlayed ?? 0)} sets</span>
          </button>`,
          () => {
            void commit(
              here ? "Removing from tonight" : "Adding to tonight",
              setAttendance(player.id, !here),
              `${here ? "Remove" : "Add"} ${player.name}`,
            );
          },
        ),
      );
    }
    pad.append(
      button(`<button class="cta ghost">Manage players</button>`, () => {
        ui.view = "players";
        ui.query = "";
        render();
      }),
      el(`<div class="muted" style="font-size:var(--step--1)">Stars are all a player is ever
        shown. Changing who is here does not re-make the teams on its own.</div>`),
    );
    return scroll;
  };

  const tabTonight = (db: Db, session: Session): HTMLElement => {
    const scroll = el<HTMLElement>(`<div class="scroll"><div class="pad"></div></div>`);
    const pad = scroll.firstElementChild as HTMLElement;

    if (session.sets.length === 0) {
      pad.append(el(`<div class="muted">No sets yet. Save one from the Court tab and it appears here
          under the teams that played it.</div>`));
      return scroll;
    }

    // Grouped under the lineup that played them, named by its actual rosters.
    for (const lineup of session.lineups) {
      const sets = setsForLineup(session, lineup.seq);
      if (sets.length === 0) continue;
      const card = el<HTMLElement>(`<div class="lineupcard">
          <header>
            <span class="eyebrow">Teams ${String(lineup.seq)}${lineup.note ? ` · ${text(lineup.note)}` : ""}</span>
            <span class="vs"><span class="g">${lineup.sideA.map((id) => text(nameOf(db, id))).join(", ")}</span><br />
              <span class="n">${lineup.sideB.map((id) => text(nameOf(db, id))).join(", ")}</span></span>
          </header><ul></ul>
        </div>`);
      const list = card.querySelector("ul") as HTMLElement;
      for (const set of sets) {
        list.append(
          el(`<li><span class="sc">${String(set.sideA.points)}&ndash;${String(set.sideB.points)}</span>
              <span class="who">${set.sideA.points > set.sideB.points ? "Gold" : "Navy"}</span></li>`),
        );
      }
      pad.append(card);
    }

    pad.append(
      button(`<button class="cta ghost">Undo the last set</button>`, () => {
        void commit("Removing the last set", deleteLastSet(), "Undo last set");
      }),
      el(`<div class="muted" style="font-size:var(--step--1)">Rating moves are organizer-only. Stars
          move when you end the session.</div>`),
    );
    return scroll;
  };

  const screenEnded = (db: Db, id: string): HTMLElement => {
    const session = db.sessions.find((s) => s.id === id);
    const { screen, pad } = shell();
    if (!session) return screen;

    // Stars "before" come from replaying with this session left open, so the
    // comparison is exact rather than remembered.
    const before = replay({
      ...db,
      sessions: db.sessions.map((s) => (s.id === id ? { ...s, closedAt: null } : s)),
    });
    const after = replay(db);
    const changed = session.attendees
      .map((playerId) => ({
        id: playerId,
        from: before.get(playerId)?.stars ?? 3,
        to: after.get(playerId)?.stars ?? 3,
      }))
      .filter((row) => row.from !== row.to);

    pad.append(
      el(`<div><div class="eyebrow">${text(session.label)}</div><h1>That's the evening</h1></div>`),
      el(`<div class="statline"><span class="big num">${String(session.sets.length)}</span>
          <span class="muted">sets across ${String(session.lineups.length)} ${
            session.lineups.length === 1 ? "lineup" : "lineups"
          }<br /><span class="eyebrow">${String(session.attendees.length)} players</span></span></div>`),
    );

    if (changed.length === 0) {
      pad.append(el(`<div class="statline"><span class="muted">Nobody changed star band tonight. That
          is the normal outcome — bands are 150 points wide and a set moves about 12.</span></div>`));
    } else {
      const byId = playerById(db);
      for (const row of changed) {
        const player = byId.get(row.id);
        if (!player) continue;
        pad.append(
          el(`<div class="statline">${avatarHtml(player, avatars)}
              <span><span class="nm">${text(player.name)}</span><br />
                <span class="stars">${starString(row.to)}</span></span>
              <span class="${row.to > row.from ? "up" : "down"}" style="margin-left:auto">
                ${row.to > row.from ? "&#9650;" : "&#9660;"} ${String(row.from)} &rarr; ${String(row.to)}</span>
            </div>`),
        );
      }
    }

    pad.append(
      button(`<button class="cta">Done</button>`, () => {
        ui.endedSessionId = null;
        render();
      }),
    );
    return screen;
  };

  // ------------------------------------------------------- player management

  /** 1–5 stars, tappable. The only level control a person ever sees. */
  const starPicker = (current: number, onPick: (stars: number) => void): HTMLElement => {
    const row = el<HTMLElement>(`<div class="starpick" role="group" aria-label="Starting level"></div>`);
    for (let stars = 1; stars <= 5; stars += 1) {
      const chosen = stars === current;
      row.append(
        button(
          `<button aria-pressed="${String(chosen)}" aria-label="${String(stars)} stars">${"★".repeat(stars)}</button>`,
          () => onPick(stars),
        ),
      );
    }
    return row;
  };

  const screenPlayers = (db: Db, standings: Standings): HTMLElement => {
    const screen = el<HTMLElement>(`<div class="phone"></div>`);
    const head = el<HTMLElement>(`<div class="shead"><span class="t">Players</span></div>`);
    head.append(
      button(`<button>Done</button>`, () => {
        ui.view = "session";
        ui.editing = null;
        ui.query = "";
        render();
      }),
    );
    screen.append(head);

    const scroll = el<HTMLElement>(`<div class="scroll"><div class="pad"></div></div>`);
    const pad = scroll.firstElementChild as HTMLElement;
    pad.append(
      el(`<div class="eyebrow">${String(db.players.length)} in the pool · ${String(
        db.players.filter((p) => p.active).length,
      )} active</div>`),
      searchField(),
    );

    for (const player of db.players.filter(matches)) {
      const standing = standings.get(player.id);
      const played = setsPlayedBy(db, player.id);
      const row = button(
        `<button class="prow" aria-pressed="${String(player.active)}">
          ${avatarHtml(player, avatars)}
          <span><span class="nm">${text(player.name)}</span><br />
            <span class="stars">${starString(standing?.stars ?? 3)}</span>
            <span class="muted" style="font-size:var(--step--1)">${
              player.active ? "" : " · inactive"
            }</span></span>
          <span class="rt">${String(played)} sets</span>
        </button>`,
        () => {
          ui.editing = ui.editing === player.id ? null : player.id;
          render();
        },
      );
      pad.append(row);

      if (ui.editing === player.id) pad.append(editPanel(player, played));
    }

    screen.append(scroll);

    const foot = el<HTMLElement>(`<div class="sticky"></div>`);
    foot.append(
      button(`<button class="cta">Add players</button>`, () => {
        ui.view = "add-players";
        ui.pasteText = "";
        ui.query = "";
        render();
      }),
    );
    screen.append(foot);
    return screen;
  };

  const editPanel = (player: Player, played: number): HTMLElement => {
    const panel = el<HTMLElement>(`<div class="card"></div>`);

    const nameField = el<HTMLElement>(`<label class="field">
        <span class="eyebrow">Name</span>
        <input type="text" value="${text(player.name)}" aria-label="Name" />
      </label>`);
    const nameInput = nameField.querySelector("input") as HTMLInputElement;
    panel.append(nameField);
    panel.append(
      button(`<button class="cta ghost">Save name</button>`, () => {
        const next = nameInput.value.trim();
        if (next.length === 0) {
          ui.error = "A player needs a name.";
          render();
          return;
        }
        void commit("Renaming", renamePlayer(player.id, next), `Rename to ${next}`);
      }),
    );

    panel.append(el(`<div><span class="eyebrow">Starting level</span>
        <div class="muted" style="font-size:var(--step--1)">This is where their rating
        <em>began</em>. Changing it re-settles their whole history, which is how a wrong
        first guess gets fixed.</div></div>`));
    panel.append(
      starPicker(seedStarsOf(player), (stars) => {
        void commit("Changing starting level", setSeedStars(player.id, stars), `Seed ${player.name} at ${String(stars)} stars`);
      }),
    );

    panel.append(
      button(
        `<button class="cta ghost">${player.active ? "Mark inactive" : "Mark active"}</button>`,
        () => {
          void commit(
            player.active ? "Marking inactive" : "Marking active",
            setPlayerActive(player.id, !player.active),
            `${player.active ? "Deactivate" : "Activate"} ${player.name}`,
          );
        },
      ),
    );

    if (played === 0) {
      panel.append(
        button(`<button class="cta ghost">Delete</button>`, () => {
          void (async () => {
            if (await commit("Deleting", removePlayer(player.id), `Delete ${player.name}`)) {
              ui.editing = null;
              render();
            }
          })();
        }),
      );
    } else {
      panel.append(el(`<div class="muted" style="font-size:var(--step--1)">${text(player.name)} has
          played ${String(played)} ${played === 1 ? "set" : "sets"}, so they cannot be deleted —
          their results are part of everyone's ratings. Mark them inactive instead.</div>`));
    }

    return panel;
  };

  const screenAddPlayers = (db: Db): HTMLElement => {
    const screen = el<HTMLElement>(`<div class="phone"></div>`);
    const head = el<HTMLElement>(`<div class="shead"><span class="t">Add players</span></div>`);
    head.append(
      button(`<button>Back</button>`, () => {
        ui.view = "players";
        render();
      }),
    );
    screen.append(head);

    const scroll = el<HTMLElement>(`<div class="scroll"><div class="pad"></div></div>`);
    const pad = scroll.firstElementChild as HTMLElement;
    pad.append(el(`<p class="muted" style="margin:0">Paste names — one per line, or straight out of
        the booking sheet. Numbering, reserve labels, prices and payment columns are thrown away.</p>`));

    const area = el<HTMLElement>(`<label class="field">
        <span class="eyebrow">Names</span>
        <textarea rows="8" aria-label="Names to add" placeholder="Maria Sz.&#10;Vadim&#10;Cheba"></textarea>
      </label>`);
    const textarea = area.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = ui.pasteText;
    textarea.addEventListener("input", () => {
      ui.pasteText = textarea.value;
      render({ refocusPaste: true });
    });
    pad.append(area);

    const parsed = parseRoster(ui.pasteText, db.players);

    pad.append(el(`<div><span class="eyebrow">Starting level for all of these</span>
        <div class="muted" style="font-size:var(--step--1)">Set it per player afterwards if they
        differ — that is the usual case.</div></div>`));
    pad.append(
      starPicker(ui.pasteStars, (stars) => {
        ui.pasteStars = stars;
        render();
      }),
    );

    if (parsed.additions.length > 0) {
      pad.append(
        el(`<div class="card"><h2>Will add ${String(parsed.additions.length)}</h2>
            <div>${parsed.additions.map((n) => text(n)).join(" · ")}</div></div>`),
      );
    }
    if (parsed.duplicates.length > 0) {
      pad.append(
        el(`<div class="card"><h2>Already in the pool</h2>
            <div class="muted">${parsed.duplicates.map((n) => text(n)).join(" · ")}</div></div>`),
      );
    }
    if (parsed.ignored.length > 0) {
      pad.append(
        el(`<details class="tools"><summary>Ignored ${String(parsed.ignored.length)} lines</summary>
            <div class="muted" style="font-size:var(--step--1)">${parsed.ignored
              .slice(0, 30)
              .map((n) => text(n))
              .join(" · ")}</div></details>`),
      );
    }

    screen.append(scroll);

    const foot = el<HTMLElement>(`<div class="sticky"></div>`);
    foot.append(
      button(
        `<button class="cta" ${parsed.additions.length === 0 ? "disabled" : ""}>Add ${String(
          parsed.additions.length,
        )} ${parsed.additions.length === 1 ? "player" : "players"}</button>`,
        () => {
          void (async () => {
            const names = parsed.additions;
            if (
              await commit(
                "Adding players",
                addPlayers(names, ui.pasteStars),
                `Add ${String(names.length)} players`,
              )
            ) {
              ui.pasteText = "";
              ui.view = "players";
              render();
            }
          })();
        },
      ),
    );
    screen.append(foot);
    return screen;
  };

  const shell = (): { screen: HTMLElement; pad: HTMLElement } => {
    const screen = el<HTMLElement>(`<div class="phone"><div class="pad"></div></div>`);
    return { screen, pad: screen.firstElementChild as HTMLElement };
  };

  // ------------------------------------------------------------- render

  function render(options?: { refocusSearch?: boolean; refocusPaste?: boolean }): void {
    const db = store.snapshot();
    const standings = replay(db);
    const session = openSessionOf(db);

    let screen: HTMLElement;
    if (ui.view === "add-players") {
      screen = screenAddPlayers(db);
    } else if (ui.view === "players") {
      screen = screenPlayers(db, standings);
    } else if (ui.endedSessionId !== null) {
      screen = screenEnded(db, ui.endedSessionId);
    } else if (ui.picking !== null) {
      screen = screenAttendance(db, standings);
    } else if (!session) {
      screen = screenIdle(db);
    } else {
      screen = el<HTMLElement>(`<div class="phone"></div>`);
      screen.append(header(session), tabs(session));
      screen.append(
        ui.tab === "court"
          ? tabCourt(db, session, standings)
          : ui.tab === "pool"
            ? tabPool(db, session, standings)
            : tabTonight(db, session),
      );
    }

    const note = banner();
    if (note) screen.prepend(note);

    root.replaceChildren(screen);

    if (options?.refocusSearch === true) {
      const input = root.querySelector<HTMLInputElement>(".search input");
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
    if (options?.refocusPaste === true) {
      const area = root.querySelector<HTMLTextAreaElement>("textarea");
      if (area) {
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
      }
    }
  }

  render();
}
