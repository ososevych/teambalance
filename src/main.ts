import { DATA_REPO } from "./config.js";
import { clearAvatarCache, clearToken, getToken, loadAvatars, setToken, StorageError } from "./storage/github.js";
import { runConflictCheck, runWriteCheck, type CheckResult } from "./storage/selfcheck.js";
import { Store } from "./storage/store.js";
import { starString } from "./core/stars.js";

/**
 * The shell. Token entry (#11) and the write-path self-check (#12).
 *
 * The session flow — court, pool, tonight — is #14 and replaces this screen.
 */

const app = document.getElementById("app");
if (!app) throw new Error("missing #app");

const el = <T extends HTMLElement>(html: string): T => {
  const host = document.createElement("div");
  host.innerHTML = html.trim();
  return host.firstElementChild as T;
};

const phone = (): { screen: HTMLElement; pad: HTMLElement } => {
  const screen = el<HTMLElement>(`<div class="phone"><div class="pad"></div></div>`);
  return { screen, pad: screen.firstElementChild as HTMLElement };
};

function renderTokenScreen(error?: string): void {
  app!.replaceChildren();
  const { screen, pad } = phone();

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

function renderConnected(store: Store, avatarCount: number): void {
  app!.replaceChildren();
  const { screen, pad } = phone();
  const db = store.snapshot();
  const standings = store.standings();

  pad.append(
    el(`<div><div class="eyebrow">teambalance</div><h1>Connected</h1></div>`),
    el(`<div class="notice ok">Reached <code>${DATA_REPO.owner}/${DATA_REPO.repo}</code>.
        ${store.isFirstRun ? "No data document yet — that is the normal first run." : "Data document loaded."}</div>`),
    el(`<div class="card">
        <h2>What is in there</h2>
        <div><span class="num">${String(db.players.length)}</span> players ·
             <span class="num">${String(db.sessions.length)}</span> sessions ·
             <span class="num">${String(db.sessions.reduce((t, s) => t + s.sets.length, 0))}</span> sets ·
             <span class="num">${String(avatarCount)}</span> photos</div>
      </div>`),
  );

  if (db.players.length > 0) {
    const list = el(`<div class="card"><h2>Pool</h2></div>`);
    for (const player of db.players) {
      list.append(
        el(`<div style="display:flex;gap:10px;align-items:baseline">
            <span>${player.name}</span>
            <span style="margin-left:auto;color:var(--gold)">${starString(standings.get(player.id)?.stars ?? 3)}</span>
          </div>`),
      );
    }
    pad.append(list);
  }

  // The write path, provable from the phone it has to work on.
  const checks = el(`<div class="card">
      <h2>Storage check</h2>
      <p class="muted" style="margin:0;font-size:var(--step--1)">Writes to
        <code>${DATA_REPO.diagnosticsPath}</code>, not your real data.</p>
    </div>`);
  const result = el<HTMLElement>(`<div></div>`);

  const run = async (label: string, check: () => Promise<CheckResult>, button: HTMLButtonElement) => {
    button.disabled = true;
    result.replaceChildren(el(`<div class="muted">${label}…</div>`));
    try {
      const outcome = await check();
      result.replaceChildren(
        el(`<div class="notice ${outcome.ok ? "ok" : ""}">
            <strong>${outcome.headline}</strong><br />
            <span class="muted">${outcome.detail}</span>
          </div>`),
      );
    } catch (error) {
      const message = error instanceof StorageError ? error.message : "Something went wrong.";
      result.replaceChildren(el(`<div class="notice"><strong>Check failed</strong><br /><span class="muted">${message}</span></div>`));
    } finally {
      button.disabled = false;
    }
  };

  const writeBtn = el<HTMLButtonElement>(`<button class="cta ghost">Write and read back</button>`);
  writeBtn.addEventListener("click", () => void run("Writing", () => runWriteCheck(getToken()!), writeBtn));

  const conflictBtn = el<HTMLButtonElement>(`<button class="cta ghost">Force a stale write</button>`);
  conflictBtn.addEventListener("click", () => void run("Sending a stale write", () => runConflictCheck(getToken()!), conflictBtn));

  checks.append(writeBtn, conflictBtn, result);
  pad.append(checks);

  pad.append(el(`<p class="muted" style="margin:0">The session flow lands here next. Until then this
      screen only proves the connection and the write path.</p>`));

  const forget = el<HTMLButtonElement>(`<button class="cta ghost">Forget this token</button>`);
  forget.addEventListener("click", () => {
    clearToken();
    clearAvatarCache();
    renderTokenScreen();
  });
  pad.append(forget);

  app!.append(screen);
}

const renderLoading = (): void => {
  app!.replaceChildren(el(`<div class="phone"><div class="pad"><p class="muted">Loading…</p></div></div>`));
};

async function boot(): Promise<void> {
  const token = getToken();
  if (!token) {
    renderTokenScreen();
    return;
  }

  renderLoading();
  try {
    const store = await Store.open(token);
    const avatars = await loadAvatars(token);
    renderConnected(store, Object.keys(avatars).length);
  } catch (error) {
    // Never fail quietly: an app that looks empty when it is actually broken is
    // the one thing that must not happen at the hall.
    const message =
      error instanceof StorageError
        ? error.message
        : "Could not reach GitHub. Check the connection and try again.";
    renderTokenScreen(message);
  }
}

void boot();
