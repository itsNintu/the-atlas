/* Credentials are deliberately not persisted in localStorage, cookies or URLs. */
let token = "";
const $ = (id) => document.getElementById(id);
const show = (id, value) =>
  ($(id).textContent =
    typeof value === "string" ? value : JSON.stringify(value, null, 2));
const fields = (form) => Object.fromEntries(new FormData(form));
const example = {
  external_id: "sample-1",
  format: "text",
  mode: "assertions",
  source_timestamp: "2026-01-01T00:00:00Z",
  payload: "Mira lives in Lisbon.",
  assertions: [{ subject: "Mira", predicate: "lives_in", object: "Lisbon" }],
};
$("source-json").value = JSON.stringify(example, null, 2);
async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  const result = await response.json();
  if (!response.ok) {
    const e = new Error(result.error.message);
    e.result = result;
    throw e;
  }
  return result;
}
async function all(path) {
  const data = [];
  let cursor = null;
  do {
    const r = await api(
      "GET",
      path +
        (path.includes("?") ? "&" : "?") +
        "limit=100" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
    );
    data.push(...r.data);
    cursor = r.next_cursor;
  } while (cursor);
  return data;
}
function action(label, fn) {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = () => run(fn);
  return b;
}
async function run(fn) {
  try {
    const value = await fn();
    if (value) show("result", value);
  } catch (e) {
    show("result", e.result || { error: { message: e.message } });
  }
}
function options(id, rows) {
  const previous = $(id).value;
  $(id).replaceChildren(
    ...rows.map((row) => {
      const o = document.createElement("option");
      o.value = row.id;
      o.textContent = row.name + (row.kind ? ` · ${row.kind}` : "");
      return o;
    }),
  );
  if (rows.some((r) => r.id === previous)) $(id).value = previous;
}
async function refresh() {
  const me = await api("GET", "/v1/me"),
    status = await api("GET", "/v1/status");
  show("identity", me.workspace.name + " / " + me.principal.name);
  show(
    "diagnostics",
    `${status.storage} · Provider ${status.provider.configured ? "configured (not verified)" : "unavailable; assertions remain usable"}`,
  );
  const [spaces, projects, jobs, sources] = await Promise.all([
    all("/v1/spaces"),
    all("/v1/projects"),
    all("/v1/jobs"),
    all("/v1/sources"),
  ]);
  options("projects", projects);
  options("ingest-space", spaces);
  $("spaces").replaceChildren(
    ...spaces.map((s) => {
      const li = document.createElement("li");
      li.textContent = `${s.name} (${s.kind}) — ${s.id}`;
      return li;
    }),
  );
  $("jobs").replaceChildren(
    ...jobs.map((j) => {
      const d = document.createElement("div");
      d.className = "row";
      d.textContent = `${j.status} · ${j.attempts} attempts · ${j.error_code || j.id}`;
      if (["failed", "retry"].includes(j.status))
        d.append(
          action("Retry", async () => {
            const r = await api("POST", `/v1/jobs/${j.id}/retry`);
            await refresh();
            return r;
          }),
        );
      return d;
    }),
  );
  $("sources").replaceChildren(
    ...sources.map((s) => {
      const d = document.createElement("div");
      d.className = "row";
      d.textContent = `${s.external_id} ${s.deleted_at ? "(forgotten)" : ""} · ${s.id} `;
      d.append(
        action("Inspect", async () => {
          const r = await api("GET", `/v1/sources/${s.id}`);
          show("source-output", r);
          $("correct-id").value = s.id;
          const rev = r.revisions.at(-1);
          $("correction-json").value = JSON.stringify(
            {
              expected_revision_number: rev.revision_number,
              format: rev.format,
              mode: rev.mode,
              source_timestamp: rev.source_timestamp,
              payload: rev.payload,
              ...(rev.mode === "assertions"
                ? { assertions: rev.assertions }
                : {}),
            },
            null,
            2,
          );
          return r;
        }),
      );
      return d;
    }),
  );
  if (me.principal.is_admin) show("principals", await all("/v1/principals"));
  else show("principals", "Workspace administration is not granted.");
}
function form(id, fn) {
  $(id).onsubmit = (e) => {
    e.preventDefault();
    run(() => fn(e.target));
  };
}
form("login", async () => {
  token = $("token").value;
  $("token").value = "";
  try {
    await refresh();
    $("connect").hidden = true;
    $("workspace").hidden = false;
    return { connected: true };
  } catch (e) {
    token = "";
    throw e;
  }
});
$("disconnect").onclick = () => {
  token = "";
  location.reload();
};
$("refresh").onclick = () => run(refresh);
form("project-form", async (f) => {
  const r = await api("POST", "/v1/projects", fields(f));
  await refresh();
  return r;
});
form("space-form", async (f) => {
  const r = await api("POST", "/v1/spaces", fields(f));
  await refresh();
  return r;
});
form("principal-form", async (f) => {
  const r = await api("POST", "/v1/principals", {
    ...fields(f),
    kind: "agent",
  });
  await refresh();
  return r;
});
form("grant-form", async (f) => {
  const b = fields(f);
  b.actions = b.actions
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const r = await api("POST", "/v1/grants", b);
  await refresh();
  return r;
});
form("ingest-form", async () => {
  const r = await api("POST", "/v1/sources", {
    ...JSON.parse($("source-json").value),
    space_id: $("ingest-space").value,
  });
  await refresh();
  return r;
});
form("context-form", async (f) => {
  const b = fields(f);
  const r = await api("POST", "/v1/context", {
    ...b,
    budget_chars: Number(b.budget_chars),
    space_ids: [$("ingest-space").value],
  });
  show("context-output", r);
  return r;
});
form("correction-form", async () => {
  const r = await api(
    "POST",
    `/v1/sources/${encodeURIComponent($("correct-id").value)}/revisions`,
    JSON.parse($("correction-json").value),
  );
  await refresh();
  return r;
});
$("forget").onclick = () =>
  run(async () => {
    const source = $("correct-id").value;
    if (!source) throw Error("Inspect a source first");
    if (
      !confirm(
        "Erase this source's payload and all its support links? This is not historical invalidation.",
      )
    )
      return;
    const r = await api("DELETE", `/v1/sources/${encodeURIComponent(source)}`);
    show("source-output", r);
    $("correction-json").value = "";
    $("correct-id").value = "";
    show(
      "context-output",
      "Source forgotten; retrieve again to inspect repaired context.",
    );
    await refresh();
    return r;
  });
