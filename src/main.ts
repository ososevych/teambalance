import { DATA_REPO } from "./config.js";
import { clearAvatarCache, clearToken, getToken, loadAvatars, setToken, StorageError } from "./storage/github.js";
import { Store } from "./storage/store.js";
import { mountApp } from "./ui/app.js";
import { el, text } from "./ui/dom.js";

const app = document.getElementById("app");
if (!app) throw new Error("missing #app");

function renderTokenScreen(error?: string): void {
  app!.replaceChildren();
  const screen = el<HTMLElement>(`<div class="phone"><div class="pad"></div></div>`);
  const pad = screen.firstElementChild as HTMLElement;

  pad.append(
    el(`<div><div class="eyebrow">teambalance</div><h1>Paste your access token</h1></div>`),
    el(`<p class="muted" style="margin:0">The app writes your sessions straight into a private
        GitHub repo, so it needs a token. It is stored only on this phone and never leaves it
        except to talk to GitHub.</p>`),
  );

  if (error !== undefined) pad.append(el(`<div class="notice">${text(error)}</div>`));

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

const forgetToken = (): void => {
  clearToken();
  clearAvatarCache();
  renderTokenScreen();
};

async function boot(): Promise<void> {
  const token = getToken();
  if (token === null) {
    renderTokenScreen();
    return;
  }

  app!.replaceChildren(el(`<div class="phone"><div class="pad"><p class="muted">Loading…</p></div></div>`));

  try {
    const store = await Store.open(token);
    const avatars = await loadAvatars(token);
    mountApp({ root: app!, store, avatars, token, onForgetToken: forgetToken });
  } catch (error) {
    // Never fail quietly. An app that looks empty when it is actually broken is
    // the one thing that must not happen at the hall.
    renderTokenScreen(
      error instanceof StorageError
        ? error.message
        : "Could not reach GitHub. Check the connection and try again.",
    );
  }
}

void boot();
