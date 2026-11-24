import { DATA_REPO } from "./config.js";
import { clearToken, getToken, loadDocument, setToken, StorageError } from "./storage/github.js";
import { replay } from "./core/replay.js";
import { starString } from "./core/stars.js";
import type { Db } from "./core/types.js";

/**
 * The shell for #11: token entry, and a read of the data document.
 *
 * The session flow (court, pool, tonight) is #14. This exists to prove the
 * deployed site opens on a phone, accepts a token, and reaches the data repo.
 */

const app = document.getElementById("app");
if (!app) throw new Error("missing #app");

const el = <T extends HTMLElement>(html: string): T => {
  const host = document.createElement("div");
  host.innerHTML = html.trim();
  return host.firstElementChild as T;
};

function renderTokenScreen(error?: string): void {
  app!.replaceChildren();
  const screen = el(`<div class="phone"><div class="pad"></div></div>`);
  const pad = screen.firstElementChild as HTMLElement;

  pad.append(
    el(`<div><div class="eyebrow">teambalance</div><h1>Paste your access token</h1></div>`),
    el(`<p class="muted" style="margin:0">The app writes your sessions straight into a private
        GitHub repo, so it needs a token. It is stored only on this phone and never leaves it
        except to talk to GitHub.</p>`),
  );

  if (error) pad.append(el(`<div class="notice">${error}</div>`));

  const field = el<HTMLElement>(`<label class="field">
      <span class="eyebrow">Fine-grained personal access token</span>
      <input type="password" inputmode="text" autocomplete="off" spellcheck="false"
             placeholder="github_pat_..." aria-label="Access token" />
    </label>`);
  const input = field.querySelector("input") as HTMLInputElement;
  pad.append(field);

  const save = el<HTMLButtonElement>(`<button class="cta" disabled>Connect</button>`);
  input.addEventListener("input", () => {
    save.disabled = input.value.trim().length === 0;
  });
  save.addEventListener("click", () => {
    setToken(input.value);
    void boot();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !save.disabled) save.click();
  });
  pad.append(save);

  pad.append(el(`<div class="card">
      <h2>Making one</h2>
      <ol class="steps">
        <li>GitHub &rarr; Settings &rarr; Developer settings &rarr; Personal access tokens &rarr; Fine-grained tokens.</li>
        <li>Repository access: <strong>only</strong> <code>${DATA_REPO.owner}/${DATA_REPO.repo}</code>.</li>
        <li>Permissions: <code>Contents: Read and write</code>. Nothing else.</li>
        <li>Expiry: 1 year — and set a calendar reminder a week before, so renewal is scheduled rather than discovered.</li>
        <li>Save it in your password manager. That is the recovery plan when this phone forgets it.</li>
      </ol>
    </div>`));

  app!.append(screen);
  input.focus();
}

function renderConnected(db: Db, sha: string | null): void {
  app!.replaceChildren();
  const standings = replay(db);
  const screen = el(`<div class="phone"><div class="pad"></div></div>`);
  const pad = screen.firstElementChild as HTMLElement;

  pad.append(
    el(`<div><div class="eyebrow">teambalance</div><h1>Connected</h1></div>`),
    el(`<div class="notice ok">Reached <code>${DATA_REPO.owner}/${DATA_REPO.repo}</code>.
        ${sha === null ? "No data document yet — that is the normal first run." : "Data document loaded."}</div>`),
    el(`<div class="card">
        <h2>What is in there</h2>
        <div><span class="num">${String(db.players.length)}</span> players ·
             <span class="num">${String(db.sessions.length)}</span> sessions ·
             <span class="num">${String(db.sessions.reduce((t, s) => t + s.sets.length, 0))}</span> sets</div>
      </div>`),
  );

  if (db.players.length > 0) {
    const list = el(`<div class="card"><h2>Pool</h2></div>`);
    for (const player of db.players) {
      const standing = standings.get(player.id);
      list.append(
        el(`<div style="display:flex;gap:10px;align-items:baseline">
            <span>${player.name}</span>
            <span style="margin-left:auto;color:var(--gold)">${starString(standing?.stars ?? 3)}</span>
          </div>`),
      );
    }
    pad.append(list);
  }

  pad.append(el(`<p class="muted" style="margin:0">The session flow lands here next. Until then this
      screen only proves the connection works.</p>`));

  const forget = el<HTMLButtonElement>(`<button class="cta ghost">Forget this token</button>`);
  forget.addEventListener("click", () => {
    clearToken();
    renderTokenScreen();
  });
  pad.append(forget);

  app!.append(screen);
}

function renderLoading(): void {
  app!.replaceChildren(el(`<div class="phone"><div class="pad"><p class="muted">Loading…</p></div></div>`));
}

async function boot(): Promise<void> {
  const token = getToken();
  if (!token) {
    renderTokenScreen();
    return;
  }

  renderLoading();
  try {
    const { db, sha } = await loadDocument(token);
    renderConnected(db, sha);
  } catch (error) {
    // Never fail quietly: an app that looks empty when it is actually broken is
    // the one thing that must not happen at the hall (#12).
    const message =
      error instanceof StorageError
        ? error.message
        : "Could not reach GitHub. Check the connection and try again.";
    renderTokenScreen(message);
  }
}

void boot();
