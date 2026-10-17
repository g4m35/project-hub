import React, { useEffect, useState, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import {
  ReactFlow,
  Handle,
  Position,
  Background,
  Controls,
  useReactFlow,
  useNodesInitialized,
} from "@xyflow/react";
import {
  Waypoints,
  Plus,
  Plug,
  FolderOpen,
  Github,
  ArrowUpRight,
  RefreshCw,
  Pause,
  Play,
  X,
  Check,
  Search,
  Boxes,
  Globe,
  Database,
  Server,
  Rocket,
  CircleAlert,
  CreditCard,
  MessageSquare,
  ChevronRight,
  Pencil,
  Trash2,
  Layers,
  ExternalLink,
  LogOut,
} from "lucide-react";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { cloud, auth, SignIn } from "./auth.jsx";

let token = "";
async function api(url, method = "GET", data) {
  const r = await fetch("/api" + url, {
    method,
    headers:
      method === "GET"
        ? {}
        : { "Content-Type": "application/json", "X-Hub-Token": token },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const value = await r.json();
  if (!r.ok) {
    const error = new Error(value.error || "Could not complete that action.");
    error.status = r.status;
    throw error;
  }
  return value;
}
const fmtDate = (value) =>
  value
    ? new Intl.DateTimeFormat("en-CA", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(value.length === 10 ? value + "T12:00:00" : value))
    : "Not available";
const localToday = () => {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
};
const connectionMessage = (error) =>
  /^Connect (GitHub|Vercel) in Connections/.test(error || "")
    ? "Not connected · updates unavailable"
    : error || "Updates unavailable";
const fmtTime = (value) => {
  if (!value) return "No successful refresh";
  const date = new Date(value);
  const time = new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return date.toDateString() === new Date().toDateString()
    ? time
    : fmtDate(value) + " · " + time;
};
const attentionLabel = (value) =>
  !value
    ? "Checking builds…"
    : value.status === "error"
      ? "Build status unavailable"
      : value.label;
const money = (s) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: s.currency,
    currencyDisplay: "code",
  }).format(s.amount);
const kinds = {
  source: Github,
  app: Globe,
  api: Server,
  data: Database,
  service: Plug,
  deploy: Rocket,
};
function Icon({ name, ...props }) {
  const I = kinds[name] || Boxes;
  return <I size={18} strokeWidth={1.7} {...props} />;
}
function Out({ href, children, className = "", ...props }) {
  return href && /^https:\/\//.test(href) ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={className}
      {...props}
    >
      {children}
    </a>
  ) : null;
}
function Empty({ icon: Icon = Boxes, title, children, action }) {
  return (
    <div className="empty">
      <Icon size={30} strokeWidth={1.4} />
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
function ErrorNote({ error }) {
  return error ? (
    <p className="error" role="alert">
      <CircleAlert size={17} />
      {error}
    </p>
  ) : null;
}
function Modal({ title, description, children, onClose, wide = false }) {
  const previous = useRef(document.activeElement);
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          className={"dialog" + (wide ? " wide" : "")}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            (previous.current?.isConnected
              ? previous.current
              : document.querySelector('[aria-label="Connections"]')
            )?.focus?.();
          }}
        >
          <div className="dialog-head">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button className="icon-button" aria-label="Close dialog">
                <X size={20} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="dialog-description">
            {description}
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function ServiceNode({ data }) {
  return (
    <div className="service-node-shell">
      <Handle type="target" position={Position.Left} />
      <button
        className="service-node"
        style={{ "--motion-order": Math.min(data.order || 0, 5) }}
        onClick={() => data.select(data)}
      >
        <span className="node-title">
          <Icon name={data.kind} />
          <strong>{data.name}</strong>
        </span>
        <span>{data.role}</span>
      </button>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { service: ServiceNode };
function FitOnResize({ container }) {
  const { fitView } = useReactFlow();
  const initialized = useNodesInitialized();
  useEffect(() => {
    if (!initialized || !container.current) return;
    let frame;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        fitView({ padding: 0.08, maxZoom: 1, duration: 0 }),
      );
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [initialized, fitView, container]);
  return null;
}
function useCompactLayout() {
  const [compact, setCompact] = useState(window.innerWidth < 750);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 749px)");
    const change = () => setCompact(mq.matches);
    mq.addEventListener("change", change);
    return () => mq.removeEventListener("change", change);
  }, []);
  return compact;
}
function StackMap({ project, onSelect }) {
  const container = useRef(null);
  const [motion, setMotion] = useState(
    () => localStorage.getItem("hub-motion") !== "paused",
  );
  const compact = useCompactLayout();
  const { nodes, edges, rowCount } = useMemo(() => {
    const groups = [
      project.stack.filter((n) => n.kind === "source" || n.kind === "deploy"),
      project.stack.filter((n) => n.kind === "app" || n.kind === "api"),
      project.stack.filter((n) => n.kind === "data" || n.kind === "service"),
    ];
    const rowCount = Math.max(...groups.map((g) => g.length));
    const nodes = groups.flatMap((group, col) =>
      group.map((n, row) => ({
        id: n.id,
        type: "service",
        position: {
          x: col * 236,
          y: (row + (rowCount - group.length) / 2) * 112,
        },
        data: { ...n, order: col + row, select: onSelect },
        ariaLabel: n.name + ", " + n.role,
        focusable: false,
      })),
    );
    const core = groups[1][0] || groups[0][0];
    const edges = core
      ? nodes
          .filter((n) => n.id !== core.id)
          .map((n) => ({
            id: core.id + "-" + n.id,
            source: ["source", "deploy"].includes(n.data.kind) ? n.id : core.id,
            target: ["source", "deploy"].includes(n.data.kind) ? core.id : n.id,
            type: "smoothstep",
            style: { stroke: "var(--edge)", strokeWidth: 1.5 },
          }))
      : [];
    return { nodes, edges, rowCount };
  }, [project, onSelect]);
  if (!nodes.length)
    return (
      <Empty title="No stack detected yet">
        No recognized project manifests were found. You can still track
        subscriptions and related work.
      </Empty>
    );
  if (compact)
    return (
      <div className="mobile-stack">
        {nodes.map(({ data: n }, index) => (
          <button
            key={project.id + n.id}
            style={{ "--motion-order": Math.min(index, 5) }}
            onClick={() => onSelect(n)}
          >
            <Icon name={n.kind} />
            <span>
              <strong>{n.name}</strong>
              <span>{n.role}</span>
            </span>
            <ChevronRight size={18} />
          </button>
        ))}
      </div>
    );
  return (
    <div
      className={"graph " + (motion ? "motion-enabled" : "motion-paused")}
      ref={container}
      style={{
        height: Math.max(370, rowCount * 112 + 70),
      }}
    >
      <ReactFlow
        key={project.id + ":" + JSON.stringify(project.stack)}
        defaultNodes={nodes}
        defaultEdges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={1.3}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        preventScrolling={false}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: false }}
      >
        <FitOnResize container={container} />
        <Background gap={22} size={1} color="var(--line)" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <button
        className="motion-toggle"
        onClick={() =>
          setMotion((enabled) => {
            localStorage.setItem("hub-motion", enabled ? "paused" : "playing");
            return !enabled;
          })
        }
        aria-label={motion ? "Pause map animations" : "Resume map animations"}
      >
        {motion ? <Pause size={15} /> : <Play size={15} />}
        {motion ? "Pause motion" : "Resume motion"}
      </button>
    </div>
  );
}
function SourceStatus({ source, label }) {
  if (!source) return <span className="muted">Loading {label}…</span>;
  if (source.status === "unlinked")
    return <span className="muted">{label} not linked</span>;
  return (
    <span
      className={"source-status " + (source.status === "error" ? "bad" : "")}
    >
      <span className="status-dot" />
      {source.status === "error"
        ? "Updates unavailable · " +
          (source.syncedAt
            ? "saved " + fmtTime(source.syncedAt)
            : "no saved results")
        : source.mode === "events"
          ? "Receiving Vercel deployment events"
          : label + " · updated " + fmtTime(source.syncedAt)}
    </span>
  );
}
function WorkRows({ rows, empty }) {
  return rows.length ? (
    <div className="rows">
      {rows.map((r) => (
        <Out key={r.id} href={r.url} className="work-row">
          <span className="issue-number">#{r.number}</span>
          <span className="row-copy">
            <strong>{r.title}</strong>
            <span>
              {r.author} · {fmtDate(r.updatedAt)}
            </span>
          </span>
          <ArrowUpRight size={18} />
        </Out>
      ))}
    </div>
  ) : (
    <div className="quiet-empty">{empty}</div>
  );
}
function stateLabel(state) {
  return (
    {
      READY: "Ready",
      ERROR: "Failed",
      BUILDING: "Building",
      QUEUED: "Queued",
      CANCELED: "Canceled",
      INITIALIZING: "Starting",
      BLOCKED: "Blocked",
      success: "Passed",
      failure: "Failed",
      cancelled: "Canceled",
      in_progress: "Running",
      queued: "Queued",
      action_required: "Action needed",
      timed_out: "Timed out",
      skipped: "Skipped",
    }[state] || state
  );
}
function runTone(s) {
  return ["READY", "success"].includes(s)
    ? "good"
    : ["ERROR", "failure", "timed_out", "BLOCKED", "action_required"].includes(
          s,
        )
      ? "bad"
      : "neutral";
}
function RunRows({ runs, historical = false }) {
  return (
    <div className="rows">
      {runs.map((r) => (
        <Out key={r.id} href={r.url} className="run-row">
          <span
            className={"run-state " + (historical ? "muted" : runTone(r.state))}
          >
            <span className="status-dot" />
            {stateLabel(r.state)}
          </span>
          <span className="row-copy">
            <strong>{r.title}</strong>
            <span>
              {r.branch} · {fmtDate(r.createdAt)}
            </span>
          </span>
          <ArrowUpRight size={18} />
        </Out>
      ))}
    </div>
  );
}

function AddProject({ onClose, onAdded, projects, linking }) {
  const [mode, setMode] = useState(cloud || linking ? "github" : "local"),
    [value, setValue] = useState(""),
    [choices, setChoices] = useState([]),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function find() {
    setBusy(true);
    setError("");
    try {
      setChoices(await api(mode === "local" ? "/discover" : "/repositories"));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function inspect(e, chosenValue = value) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      setPreview(
        await api(
          "/preview",
          "POST",
          mode === "local" ? { path: chosenValue } : { repo: chosenValue },
        ),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function add() {
    setBusy(true);
    setError("");
    try {
      const r = await api(
        linking ? "/projects/" + linking.id + "/repository" : "/projects",
        "POST",
        preview.path
          ? { path: preview.path, name: preview.name }
          : { repo: preview.repo },
      );
      await onAdded(linking ? r : r.project);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        preview
          ? "Ready to connect"
          : linking
            ? "Link repository to " + linking.name
            : "Add a project"
      }
      description={
        preview
          ? "Review what the hub found. Existing account connections are reused."
          : linking
            ? "Choose its repository. Your project name, chats and subscriptions stay together."
            : cloud
              ? "Choose a GitHub repository to detect its stack. You can connect hosting afterward."
              : "Choose a local folder or a GitHub repository. The hub detects the stack for you."
      }
      onClose={onClose}
    >
      {!preview ? (
        <>
          {!cloud && !linking && (
            <div className="segmented">
              <button
                className={mode === "local" ? "active" : ""}
                onClick={() => {
                  setMode("local");
                  setChoices([]);
                  setValue("");
                }}
              >
                Local folder
              </button>
              <button
                className={mode === "github" ? "active" : ""}
                onClick={() => {
                  setMode("github");
                  setChoices([]);
                  setValue("");
                }}
              >
                GitHub repository
              </button>
            </div>
          )}
          <form onSubmit={inspect}>
            <label className="field">
              {mode === "local" ? "Project folder" : "Repository URL"}
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={
                  mode === "local"
                    ? "Paste a folder path, e.g. ~/Desktop/my-app"
                    : "https://github.com/owner/project"
                }
                required
                autoComplete="off"
              />
            </label>
            <div className="actions">
              <button type="button" onClick={find} disabled={busy}>
                <Search size={17} />
                {mode === "local" ? "Find on my Mac" : "Choose from GitHub"}
              </button>
              <button className="primary" disabled={busy || !value}>
                {busy ? "Checking…" : "Detect stack"}
                <ChevronRight size={17} />
              </button>
            </div>
          </form>
          {choices.length > 0 && (
            <div className="picker-list" aria-label="Available projects">
              {choices.map((c) => {
                const existing = projects.find(
                  (p) =>
                    c.repo && p.repo?.toLowerCase() === c.repo.toLowerCase(),
                );
                const unavailable =
                  linking && existing && existing.id !== linking.id;
                return (
                  <button
                    key={c.path || c.repo}
                    disabled={busy || unavailable}
                    onClick={async () => {
                      if (existing && !linking) {
                        await onAdded(existing);
                        onClose();
                        return;
                      }
                      setValue(c.path || c.repo);
                      setChoices([]);
                      await inspect(null, c.path || c.repo);
                    }}
                  >
                    <FolderOpen size={18} />
                    <span>
                      <strong>{c.name}</strong>
                      <span>
                        {existing
                          ? "In hub · " + existing.name
                          : c.path || c.repo}
                      </span>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="detected">
            <h3>{preview.name}</h3>
            <p>{preview.path || preview.repo}</p>
            <div className="stack-tags">
              {preview.stack.length ? (
                preview.stack.map((n) => (
                  <span key={n.id}>
                    <Icon name={n.kind} />
                    {n.name}
                  </span>
                ))
              ) : (
                <p>No recognized stack yet. You can still add this project.</p>
              )}
            </div>
            <p>
              <Check size={16} />{" "}
              {preview.repo
                ? "GitHub issues will refresh automatically."
                : "Local folder ready. No GitHub remote was found."}
            </p>
          </div>
          <div className="actions">
            <button onClick={() => setPreview(null)}>Back</button>
            <button className="primary" onClick={add} disabled={busy}>
              {busy
                ? "Connecting…"
                : linking
                  ? "Link repository"
                  : "Add project"}
            </button>
          </div>
        </>
      )}
      <ErrorNote error={error} />
    </Modal>
  );
}
function SubscriptionForm({
  subscription,
  projects,
  projectId,
  onClose,
  onSaved,
}) {
  const [form, setForm] = useState(
      subscription || {
        name: "",
        amount: "",
        currency: "CAD",
        interval: "monthly",
        nextDue: "",
        projectId: projectId || "shared",
        notes: "",
      },
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false);
  const keepButton = useRef(null);
  const deleteButton = useRef(null);
  useEffect(() => {
    if (deleting) {
      keepButton.current?.focus();
      keepButton.current?.scrollIntoView({ block: "nearest" });
    }
  }, [deleting]);
  const change = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  async function save(e) {
    e.preventDefault();
    if (deleting) return;
    setBusy(true);
    setError("");
    try {
      await api(
        "/subscriptions" + (subscription ? "/" + subscription.id : ""),
        subscription ? "PUT" : "POST",
        form,
      );
      await onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api("/subscriptions/" + subscription.id, "DELETE");
      await onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <Modal
      title={subscription ? "Edit subscription" : "Add subscription"}
      description="Enter the amount and next payment date from your bill. Shared subscriptions are counted once."
      onClose={onClose}
    >
      <form onSubmit={save}>
        <label className="field">
          Service
          <input
            name="name"
            value={form.name}
            onChange={change}
            required
            maxLength={100}
            placeholder="e.g. Vercel"
          />
        </label>
        <div className="form-grid">
          <label className="field">
            Amount
            <input
              name="amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={change}
              required
              placeholder="0.00"
            />
          </label>
          <label className="field">
            Currency
            <select name="currency" value={form.currency} onChange={change}>
              {["CAD", "USD", "EUR", "GBP", "AUD", "JPY", "INR"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-grid">
          <label className="field">
            Billing period
            <select name="interval" value={form.interval} onChange={change}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="one-time">One-time</option>
            </select>
          </label>
          <label className="field">
            Next payment
            <input
              name="nextDue"
              type="date"
              value={form.nextDue}
              onChange={change}
              required
            />
          </label>
        </div>
        <label className="field">
          Project
          <select name="projectId" value={form.projectId} onChange={change}>
            <option value="shared">Shared across projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Notes (optional)
          <textarea
            name="notes"
            value={form.notes}
            onChange={change}
            rows={3}
            placeholder="Plan name or billing reference"
          />
        </label>
        <ErrorNote error={error} />
        <div className="actions">
          {subscription ? (
            <button
              type="button"
              className="danger-text"
              ref={deleteButton}
              disabled={busy || deleting}
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={16} />
              Delete
            </button>
          ) : (
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          )}
          <button className="primary" disabled={busy || deleting}>
            {busy ? "Saving…" : "Save subscription"}
          </button>
        </div>
        {deleting && (
          <div
            className="delete-confirm"
            role="group"
            aria-labelledby="delete-prompt"
          >
            <p id="delete-prompt" role="alert">
              Delete {subscription.name} from this hub? This does not cancel the
              service.
            </p>
            <button
              type="button"
              className="danger-text"
              onClick={remove}
              disabled={busy}
            >
              Delete record
            </button>
            <button
              ref={keepButton}
              type="button"
              disabled={busy}
              onClick={() => {
                setDeleting(false);
                requestAnimationFrame(() => deleteButton.current?.focus());
              }}
            >
              Keep it
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
function CloudConnectionForm({ onSaved, provider, onCancel }) {
  const [value, setValue] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/connections/" + provider, "POST", { token: value });
      setValue("");
      await onSaved();
      onCancel();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="cloud-connection-form" onSubmit={save}>
      <h3>Connect {provider === "vercel" ? "Vercel" : "GitHub"}</h3>
      <p>
        {provider === "vercel"
          ? "Create a token with access to the Vercel team that owns your projects, then paste it here."
          : "Use a fine-grained token with read access to your repositories, issues, pull requests and Actions."}{" "}
        <Out
          href={
            provider === "vercel"
              ? "https://vercel.com/account/settings/tokens"
              : "https://github.com/settings/personal-access-tokens/new"
          }
        >
          Open token settings <ArrowUpRight size={14} />
        </Out>
      </p>
      <label className="field">
        {provider === "vercel" ? "Vercel" : "GitHub"} access token
        <input
          type="password"
          required
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste token"
        />
      </label>
      <ErrorNote error={error} />
      <div className="actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            onCancel();
            setValue("");
          }}
        >
          Cancel
        </button>
        <button className="primary" disabled={busy || !value}>
          {busy ? "Connecting…" : "Connect account"}
        </button>
      </div>
    </form>
  );
}
function Connections({
  project,
  onClose,
  onSaved,
  initialProvider,
  onLinkRepository,
  onSignOut,
}) {
  const [editingProvider, setEditingProvider] = useState(
    initialProvider || null,
  );
  const [data, setData] = useState(null),
    [choices, setChoices] = useState(null),
    [chosen, setChosen] = useState(project?.vercel?.projectId || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load() {
    setError("");
    try {
      setData(await api("/connections?refresh=1"));
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function list() {
    setBusy(true);
    try {
      setChoices(await api("/vercel-projects"));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function link() {
    setBusy(true);
    try {
      await api("/projects/" + project.id + "/vercel", "POST", {
        projectId: chosen,
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Connections"
      description={
        cloud
          ? "Your provider connections work in the cloud. Access tokens are encrypted and used only by the server."
          : "Your existing Mac sign-ins are reused. Credentials stay on this Mac."
      }
      onClose={onClose}
    >
      <div className="connection-list">
        {["github", "vercel"].map((provider) => (
          <div key={provider}>
            <span className="connection-icon">
              {provider === "github" ? <Github /> : <Rocket />}
            </span>
            <span className="row-copy">
              <strong>{provider === "github" ? "GitHub" : "Vercel"}</strong>
              <span>
                {data
                  ? data[provider].connected
                    ? data[provider].account
                    : cloud
                      ? connectionMessage(data[provider].error)
                      : data[provider].error
                  : "Checking connection…"}
              </span>
            </span>
            {cloud ? (
              <button
                className="text-button"
                onClick={() => setEditingProvider(provider)}
              >
                {data?.[provider].connected ? "Update" : "Connect"}
                <span className="sr-only">
                  {" "}
                  {provider === "vercel" ? "Vercel" : "GitHub"}
                </span>
              </button>
            ) : (
              data?.[provider].connected && <Check className="good" size={20} />
            )}
          </div>
        ))}
      </div>
      {cloud && editingProvider && (
        <CloudConnectionForm
          key={editingProvider}
          provider={editingProvider}
          onCancel={() => setEditingProvider(null)}
          onSaved={async () => {
            await load();
            await onSaved();
          }}
        />
      )}
      {project && (
        <div className="connection-project">
          <h3>{project.name}</h3>
          <p>
            {project.repo
              ? "Repository: " + project.repo
              : "No GitHub repository detected."}
          </p>
          {!project.repo && (
            <button onClick={onLinkRepository}>
              <Github size={17} />
              Link repository
            </button>
          )}
          <p>
            {project.vercel
              ? data?.vercel.connected
                ? "Vercel project linked; updates enabled."
                : "Vercel project saved. Connect your Vercel account to enable updates."
              : "Link a Vercel project to see its deployments."}
          </p>
          {!data?.vercel.connected ? null : !choices ? (
            <button onClick={list} disabled={busy || !data?.vercel.connected}>
              {busy
                ? "Loading…"
                : project.vercel
                  ? "Change Vercel project"
                  : "Choose Vercel project"}
            </button>
          ) : (
            <>
              <label className="field">
                Vercel project
                <select
                  value={chosen}
                  onChange={(e) => setChosen(e.target.value)}
                >
                  <option value="">Choose a project</option>
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.repo ? " · " + c.repo : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary"
                onClick={link}
                disabled={busy || !chosen}
              >
                Link project
              </button>
            </>
          )}
        </div>
      )}
      <p className="connection-note">
        This project’s issues and deployments check every 30 seconds while the
        hub is visible. Other projects’ build summaries check every 2 minutes.
        Vercel deployment events and Mac chat activity check every 10 seconds.
        Disconnected sources are clearly marked. Other detected services have no
        runtime health connection.
      </p>
      <ErrorNote error={error} />
      <button onClick={load}>
        <RefreshCw size={16} />
        Recheck connections
      </button>
      {cloud && (
        <button className="sign-out" onClick={onSignOut}>
          <LogOut size={17} />
          Sign out
        </button>
      )}
    </Modal>
  );
}
function CurrentWork({ project, snap, onIssues }) {
  return (
    <section>
      <div className="section-head">
        <h2>Current work</h2>
        {project.repo && (
          <button className="text-button" onClick={onIssues}>
            All issues
            <ArrowUpRight size={16} />
          </button>
        )}
      </div>
      {!snap ? (
        <p className="quiet-empty">Loading GitHub…</p>
      ) : snap.github.status === "unlinked" ? (
        <p className="quiet-empty">
          Link a repository to see issues and pull requests here.
        </p>
      ) : snap.github.status === "error" ? (
        <ErrorNote error={snap.github.error} />
      ) : (
        <WorkRows
          rows={[...snap.github.issues, ...snap.github.pulls].slice(0, 3)}
          empty="No open issues or pull requests."
        />
      )}
    </section>
  );
}
function ChatPanel({ source, compact = false, onAll }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [scope, setScope] = useState("project");
  const [copied, setCopied] = useState("");
  const connected = source?.status === "connected";
  const rows = connected
    ? (scope === "all" ? source.allChats || [] : source.chats || []).filter(
        (c) =>
          c.title.toLowerCase().includes(query.toLowerCase()) &&
          (filter === "all" ||
            (filter === "needs_input"
              ? c.state === "needs_input"
              : c.state === "active")),
      )
    : [];
  const label = !source
    ? "Connecting to your Mac…"
    : connected
      ? "Synced from your Mac · " + fmtTime(source.syncedAt)
      : source.status === "offline"
        ? "Mac offline · last seen " + fmtTime(source.syncedAt)
        : source.status === "unconnected"
          ? "Mac sync is not connected"
          : "Chat updates are unavailable";
  const labels = {
    active: "Active recently",
    needs_input: "Needs you",
    idle: "Idle",
    error: "Failed",
  };
  async function copy(c) {
    try {
      await navigator.clipboard.writeText(c.title);
      setCopied(c.id);
    } catch {
      setCopied("failed");
    }
  }
  return (
    <section className="live-chats">
      <div className="section-head">
        <h2>Chats</h2>
        {compact && (
          <button className="text-button" onClick={onAll}>
            All chats <ArrowUpRight size={16} />
          </button>
        )}
      </div>
      <p
        className={"live-source " + (connected ? "connected" : "")}
        role="status"
      >
        <span className="status-dot" />
        {label}
      </p>
      {!compact && (
        <div className="chat-tools">
          <select
            aria-label="Chat scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="project">This project</option>
            <option value="all">All chats</option>
          </select>
          <label className="chat-search">
            <Search size={17} />
            <input
              aria-label="Search chats"
              placeholder="Find a chat"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="chat-filters" aria-label="Filter chats">
            {[
              ["all", "All"],
              ["active", "Active"],
              ["needs_input", "Needs you"],
            ].map(([value, title]) => (
              <button
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {title}
              </button>
            ))}
          </div>
        </div>
      )}
      {connected &&
        Object.values(source.sources || {}).includes("unavailable") && (
          <p className="build-note">
            One chat app could not be read. Showing chats from the connected
            app.
          </p>
        )}
      {rows.length ? (
        <div className="chat-list">
          {rows.slice(0, compact ? 3 : 80).map((c) => (
            <div key={c.app + ":" + c.id} className="live-chat-row">
              <MessageSquare size={17} />
              <span className="chat-copy">
                <strong>{c.title}</strong>
                <span>
                  {c.app} · {fmtTime(c.updatedAt)}
                </span>
              </span>
              <span className={"chat-state " + c.state}>
                {labels[c.state] || "Unknown"}
              </span>
              {!compact &&
                (c.app === "Codex" ? (
                  <a
                    className="text-button"
                    href={"codex://threads/" + encodeURIComponent(c.id)}
                    title="Open this chat in Codex on your Mac"
                  >
                    Open on Mac <ArrowUpRight size={15} />
                  </a>
                ) : (
                  <button className="text-button" onClick={() => copy(c)}>
                    {copied === c.id ? "Copied" : "Copy title"}
                  </button>
                ))}
            </div>
          ))}
        </div>
      ) : (
        <p className="quiet-empty">
          {!connected
            ? source?.status === "offline"
              ? "Updates resume automatically when your Mac wakes. Old chat states are hidden."
              : "Waiting for a current connection to your Mac."
            : query || filter !== "all"
              ? "No chats match this filter."
              : "No chats are linked to this project yet."}
        </p>
      )}
      {!compact && (
        <p className="build-note">
          Updates every 10 seconds while open. Titles and activity only; full
          conversations stay in their apps. Codex links open on your Mac.
        </p>
      )}
      {copied === "failed" && (
        <p role="alert">
          Clipboard unavailable. Select the chat title to copy it.
        </p>
      )}
    </section>
  );
}
function SyncStatus({ source, refreshing, nextCheckAt, onRefresh }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const connected = source?.status === "connected";
  const remaining = Math.min(
    30,
    Math.max(0, Math.ceil((nextCheckAt - now) / 1000)),
  );
  const label = refreshing
    ? "Checking for updates…"
    : connected
      ? "GitHub updated " + fmtTime(source.syncedAt)
      : source?.status === "error"
        ? "GitHub updates unavailable"
        : "Waiting for GitHub";
  return (
    <div className={"sync-bar" + (connected ? " connected" : "")}>
      <div className="sync-copy">
        <span
          key={source?.syncedAt}
          className={"sync-dot" + (refreshing ? " checking" : "")}
          aria-hidden="true"
        />
        <span>
          <span role="status">{label}</span>
          <span className="sync-next">
            {refreshing
              ? "Fetching current issues and build results"
              : "Checks every 30s · next in " + remaining + "s"}
          </span>
        </span>
      </div>
      <button
        className="text-button"
        onClick={onRefresh}
        disabled={refreshing}
        aria-busy={refreshing}
      >
        <RefreshCw size={16} />
        {refreshing ? "Checking…" : "Refresh now"}
      </button>
    </div>
  );
}
function App() {
  const compact = useCompactLayout();
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [data, setData] = useState(null),
    [selected, setSelected] = useState(
      localStorage.getItem("hub-project") || "",
    ),
    [tab, setTab] = useState("map"),
    [snap, setSnap] = useState(null),
    [chats, setChats] = useState(null),
    [modal, setModal] = useState(null),
    [error, setError] = useState(""),
    [refreshing, setRefreshing] = useState(false),
    [search, setSearch] = useState(""),
    [allBills, setAllBills] = useState(true),
    [notice, setNotice] = useState("");
  const [attention, setAttention] = useState({});
  const request = useRef(0);
  const refreshProject = useRef(null);
  const refreshLive = useRef(null);
  const [live, setLive] = useState(null);
  const [nextCheckAt, setNextCheckAt] = useState(null);
  const projectKey =
    data?.projects.map((p) => p.id + ":" + p.repo).join("|") || "";
  useEffect(() => {
    if (!data) return;
    let gone = false,
      working = false;
    const projects = data.projects.filter((p) => p.repo);
    async function update() {
      if (working || document.hidden) return;
      working = true;
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(3, projects.length) }, async () => {
          while (!gone && index < projects.length) {
            const item = projects[index++];
            try {
              const result = await api("/projects/" + item.id + "/attention");
              if (!gone) setAttention((old) => ({ ...old, [item.id]: result }));
            } catch {
              if (!gone)
                setAttention((old) => ({
                  ...old,
                  [item.id]: {
                    status: "error",
                    label: "Build status unavailable",
                  },
                }));
            }
          }
        }),
      );
      working = false;
    }
    update();
    const timer = setInterval(update, 120000);
    document.addEventListener("visibilitychange", update);
    return () => {
      gone = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [projectKey]);
  const project =
    data?.projects.find((p) => p.id === selected) || data?.projects[0];
  const deployment = live?.vercel || snap?.vercel;
  async function load() {
    let d;
    try {
      if (cloud && !(await api("/session")).authenticated) {
        setData(null);
        setNeedsSignIn(true);
        return null;
      }
      d = await api("/state");
    } catch (e) {
      if (cloud && e.status === 401) {
        setData(null);
        setNeedsSignIn(true);
      }
      throw e;
    }
    setNeedsSignIn(false);
    token = d.csrf;
    setData(d);
    return d;
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
    const timer = setInterval(
      () => {
        if (!document.hidden) load().catch(() => {});
      },
      cloud ? 30000 : 10000,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!project) return;
    setSnap(null);
    setChats(null);
    setError("");
    let gone = false,
      working = false,
      timer;
    const epoch = ++request.current;
    async function update(force = false) {
      if (gone || working) return;
      clearTimeout(timer);
      if (document.hidden) return;
      working = true;
      setRefreshing(true);
      setNextCheckAt(null);
      try {
        const suffix = force ? "?refresh=1" : "";
        const [snapshot, builds] = await Promise.all([
          api("/projects/" + project.id + "/snapshot" + suffix),
          api("/projects/" + project.id + "/attention" + suffix),
        ]);
        if (!gone && epoch === request.current) {
          setSnap(snapshot);
          setAttention((old) => ({ ...old, [project.id]: builds }));
          setError("");
        }
      } catch (e) {
        if (!gone && epoch === request.current) {
          setError(e.message);
          setSnap(
            (previous) =>
              previous && {
                ...previous,
                github: {
                  ...previous.github,
                  status: "error",
                  error: e.message,
                  stale: true,
                },
              },
          );
        }
      } finally {
        working = false;
        if (!gone && epoch === request.current) {
          setRefreshing(false);
          setNextCheckAt(Date.now() + 30000);
          timer = setTimeout(() => update(), 30000);
        }
      }
    }
    const onVisible = () => {
      if (!document.hidden) update();
    };
    refreshProject.current = () => update(true);
    update();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      gone = true;
      clearTimeout(timer);
      refreshProject.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [project?.id, project?.repo, project?.vercel?.projectId]);
  useEffect(() => {
    if (!project) return;
    let gone = false,
      working = false,
      timer;
    setLive(null);
    setChats(null);
    async function update() {
      if (gone || working || document.hidden) return;
      working = true;
      clearTimeout(timer);
      try {
        const value = await api("/projects/" + project.id + "/live");
        if (!gone) {
          setLive(value);
          setChats(value.chats);
        }
      } catch {
        if (!gone) {
          setChats({ status: "error", chats: [] });
          setLive(
            (previous) =>
              previous && {
                ...previous,
                vercel: previous.vercel && {
                  ...previous.vercel,
                  status: "error",
                  error: "Deployment updates could not be checked.",
                },
              },
          );
        }
      } finally {
        working = false;
        if (!gone) timer = setTimeout(update, 10000);
      }
    }
    const visible = () => {
      if (!document.hidden) update();
    };
    refreshLive.current = update;
    update();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", visible);
    return () => {
      gone = true;
      clearTimeout(timer);
      refreshLive.current = null;
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", visible);
    };
  }, [project?.id, project?.vercel?.projectId]);
  async function refresh() {
    return Promise.all([refreshProject.current?.(), refreshLive.current?.()]);
  }
  async function signOut() {
    setModal(null);
    await action(async () => {
      const result = await auth.signOut();
      if (result.error) throw new Error(result.error.message);
      setModal(null);
      setData(null);
      setAttention({});
      setNeedsSignIn(true);
    }, "Signed out.");
  }
  function choose(p) {
    setSelected(p);
    localStorage.setItem("hub-project", p);
    setModal(null);
  }
  async function action(fn, message) {
    try {
      await fn();
      setNotice(message);
      setTimeout(() => setNotice(""), 4500);
    } catch (e) {
      setError(e.message);
    }
  }
  const bills = (data?.subscriptions || [])
    .filter(
      (s) =>
        allBills || s.projectId === project?.id || s.projectId === "shared",
    )
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue));
  const totals = Object.entries(
    bills
      .filter((s) => s.interval === "monthly")
      .reduce(
        (a, s) => ({ ...a, [s.currency]: (a[s.currency] || 0) + s.amount }),
        {},
      ),
  );
  if (needsSignIn) return <SignIn onSignedIn={load} />;
  if (!data)
    return (
      <div className="boot">
        <Waypoints size={34} />
        <h1>Project hub</h1>
        <p>{error || "Finding your projects…"}</p>
        {error && (
          <button onClick={() => load().catch((e) => setError(e.message))}>
            Try again
          </button>
        )}
      </div>
    );
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Project hub home">
          <Waypoints size={23} />
          <strong>Project hub</strong>
        </a>
        <div className="project-search">
          <Search size={16} />
          <input
            aria-label="Find a project"
            placeholder="Find a project"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="mobile-project-select"
          aria-label="Choose project"
          value={project?.id || ""}
          onChange={(e) => choose(e.target.value)}
        >
          {data.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {attention[p.id]?.status === "connected" &&
              attention[p.id]?.tone === "bad"
                ? " — review builds"
                : ""}
            </option>
          ))}
        </select>
        <nav aria-label="Projects" className="project-nav">
          {data.projects
            .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
            .map((p) => (
              <button
                key={p.id}
                className={
                  "project-link" + (p.id === project?.id ? " selected" : "")
                }
                aria-current={p.id === project?.id ? "page" : undefined}
                onClick={() => choose(p.id)}
                title={
                  p.repo
                    ? attentionLabel(attention[p.id])
                    : "No GitHub repository linked"
                }
              >
                <span
                  className={
                    "project-health " +
                    (attention[p.id]?.status === "connected"
                      ? attention[p.id].tone
                      : "neutral")
                  }
                  aria-hidden="true"
                >
                  {attention[p.id]?.status === "connected" &&
                  attention[p.id].tone === "bad" ? (
                    <CircleAlert size={16} />
                  ) : attention[p.id]?.status === "connected" &&
                    attention[p.id].tone === "good" ? (
                    <Check size={16} />
                  ) : (
                    <span className="status-dot" />
                  )}
                </span>
                <span>
                  {p.name}
                  <span className="sr-only">
                    {" "}
                    ·{" "}
                    {p.repo
                      ? attentionLabel(attention[p.id])
                      : "No repository linked"}
                  </span>
                </span>
              </button>
            ))}
          {search &&
            !data.projects.some((p) =>
              p.name.toLowerCase().includes(search.toLowerCase()),
            ) && (
              <p className="no-match" role="status">
                No projects match.
              </p>
            )}
        </nav>
        <button
          className="add-project"
          aria-label="Add project"
          onClick={() => setModal({ type: "add" })}
        >
          <Plus size={18} />
          Add project
        </button>
        <div className="sidebar-bottom">
          <button
            aria-label="Connections"
            onClick={() => setModal({ type: "connections" })}
          >
            <Plug size={18} />
            <span>Connections</span>
          </button>
        </div>
      </aside>
      <main className="main">
        {!project ? (
          <Empty
            title={
              data.initialization
                ? "Importing your projects…"
                : "Your projects, in one place"
            }
            action={
              <button
                className="primary"
                onClick={() => setModal({ type: "add" })}
              >
                <Plus size={17} />
                Add project
              </button>
            }
          >
            Connect a folder or repository to get started.
          </Empty>
        ) : (
          <>
            <header className="header">
              <div>
                <h1>{project.name}</h1>
                <p>
                  {project.repo ||
                    (cloud ? "Imported project" : "Local project")}
                </p>
              </div>
              <div className="header-actions">
                {project.path && (
                  <button
                    aria-label="Open project folder"
                    onClick={() =>
                      action(
                        () =>
                          api("/projects/" + project.id + "/open", "POST", {}),
                        "Opened project folder.",
                      )
                    }
                  >
                    <FolderOpen size={17} />
                    <span>Folder</span>
                  </button>
                )}
                {project.repo && (
                  <Out
                    href={"https://github.com/" + project.repo}
                    aria-label="Open repository"
                    className="button"
                  >
                    <Github size={17} />
                    <span>Repository</span>
                  </Out>
                )}
              </div>
            </header>
            <Tabs.Root value={tab} onValueChange={setTab}>
              <Tabs.List className="tabbar" aria-label="Project view">
                {[
                  ["map", "Stack map", Waypoints],
                  ["issues", "Issues", CircleAlert],
                  ["deployments", "Deployments", Rocket],
                  ["chats", "Chats", MessageSquare],
                  ["costs", "Subscriptions", CreditCard],
                ].map(([v, t, I]) => (
                  <Tabs.Trigger key={v} value={v}>
                    <I size={17} />
                    {t}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
              <div className="content">
                {project.repo && !["costs", "chats"].includes(tab) && (
                  <SyncStatus
                    source={snap?.github}
                    refreshing={refreshing}
                    nextCheckAt={nextCheckAt}
                    onRefresh={refresh}
                  />
                )}
                <ErrorNote error={error} />
                <Tabs.Content value="map">
                  <div className="map-layout">
                    {compact && (
                      <CurrentWork
                        project={project}
                        snap={snap}
                        onIssues={() => setTab("issues")}
                      />
                    )}
                    <section className="stack-section">
                      <div className="view-toolbar">
                        <p>Detected services</p>
                        {cloud && !project.repo ? (
                          <button
                            className="text-button"
                            onClick={() => setModal({ type: "link" })}
                          >
                            <Github size={16} />
                            Link repository
                          </button>
                        ) : (
                          <button
                            className="text-button"
                            onClick={() =>
                              action(async () => {
                                await api(
                                  "/projects/" + project.id + "/rescan",
                                  "POST",
                                  {},
                                );
                                await load();
                              }, "Stack updated from project files.")
                            }
                          >
                            <RefreshCw size={15} />
                            Rescan
                          </button>
                        )}
                      </div>
                      <StackMap
                        project={project}
                        onSelect={(node) => setModal({ type: "node", node })}
                      />
                      <div className="map-foot">
                        <span>
                          Detected dependencies · connections show suggested
                          roles
                        </span>
                        <span>Scanned {fmtDate(project.scannedAt)}</span>
                      </div>
                    </section>
                    <div className="lower-grid">
                      {!compact && (
                        <CurrentWork
                          project={project}
                          snap={snap}
                          onIssues={() => setTab("issues")}
                        />
                      )}
                      <ChatPanel
                        source={chats}
                        compact
                        onAll={() => setTab("chats")}
                      />
                    </div>
                  </div>
                </Tabs.Content>
                <Tabs.Content value="chats">
                  <ChatPanel source={chats} />
                </Tabs.Content>
                <Tabs.Content value="issues">
                  <div className="view-toolbar">
                    <SourceStatus source={snap?.github} label="GitHub" />
                  </div>
                  <ErrorNote error={snap?.github.error} />
                  {!snap ? (
                    <Empty title="Loading issues…">
                      Checking the connected repository.
                    </Empty>
                  ) : snap.github.status === "unlinked" ? (
                    <Empty
                      icon={Github}
                      title="Connect this project to GitHub"
                      action={
                        <button onClick={() => setModal({ type: "link" })}>
                          <Github size={17} />
                          Link repository
                        </button>
                      }
                    >
                      Keep this project’s name, chats and subscriptions.
                      Projects without a repository can still track
                      subscriptions.
                    </Empty>
                  ) : (
                    <>
                      <div className="section-head">
                        <h2>Open issues</h2>
                        {project.repo && (
                          <Out
                            href={
                              "https://github.com/" +
                              project.repo +
                              "/issues/new"
                            }
                            className="text-button"
                          >
                            New on GitHub
                            <ArrowUpRight size={16} />
                          </Out>
                        )}
                      </div>
                      <WorkRows
                        rows={snap.github.issues}
                        empty={
                          snap.github.status === "error"
                            ? "Issue data is unavailable."
                            : "No open issues."
                        }
                      />
                      <div className="section-head spaced">
                        <h2>Pull requests</h2>
                      </div>
                      <WorkRows
                        rows={snap.github.pulls}
                        empty={
                          snap.github.status === "error"
                            ? "Pull request data is unavailable."
                            : "No open pull requests."
                        }
                      />
                      {snap.github.truncated && (
                        <p className="muted">
                          Showing the 1,000 most recently updated items. Open
                          GitHub for the full list.
                        </p>
                      )}
                    </>
                  )}
                </Tabs.Content>
                <Tabs.Content value="deployments">
                  <div className="view-toolbar">
                    <h2>
                      Builds
                      {attention[project.id]?.branch
                        ? " · " + attention[project.id].branch
                        : ""}
                    </h2>
                  </div>
                  {!project.repo ? (
                    <p className="quiet-empty">
                      Link a repository to see its builds.{" "}
                      <button
                        className="text-button"
                        onClick={() => setModal({ type: "link" })}
                      >
                        Link repository
                      </button>
                    </p>
                  ) : !attention[project.id] ? (
                    <p role="status">Checking the default branch…</p>
                  ) : attention[project.id].status === "error" ? (
                    <ErrorNote
                      error={
                        attention[project.id].error ||
                        "Build status is unavailable. Try refreshing."
                      }
                    />
                  ) : (
                    <>
                      <p className="build-note">
                        Latest available run per active workflow on the default
                        branch · checked{" "}
                        {fmtTime(attention[project.id].syncedAt)}
                      </p>
                      {attention[project.id].coverageComplete === false && (
                        <p className="build-note">
                          Some active workflows have no result in the latest 100
                          runs. Overall build health is unknown.
                        </p>
                      )}
                      {attention[project.id].runs?.length ? (
                        <RunRows runs={attention[project.id].runs} />
                      ) : (
                        <p className="quiet-empty">
                          No recent workflow runs on this branch.
                        </p>
                      )}
                    </>
                  )}
                  {!!snap?.github.runs?.length && (
                    <details className="run-history">
                      <summary>Recent runs across all branches</summary>
                      <RunRows runs={snap.github.runs} />
                    </details>
                  )}
                  <section className="deployment-section">
                    <div className="section-head">
                      <h2>Vercel deployments</h2>
                      {deployment?.status !== "error" && (
                        <button
                          className="text-button"
                          onClick={() =>
                            setModal({
                              type: "connections",
                              provider:
                                deployment?.status !== "connected"
                                  ? "vercel"
                                  : null,
                            })
                          }
                        >
                          <Plug size={16} />
                          {deployment?.status === "connected"
                            ? "Manage connection"
                            : "Connect Vercel"}
                        </button>
                      )}
                    </div>
                    {!deployment ? (
                      <p className="quiet-empty">Loading deployments…</p>
                    ) : (
                      <>
                        {deployment?.status === "error" ? (
                          <div className="snapshot-notice" role="status">
                            <p>
                              <strong>Vercel updates are unavailable.</strong>{" "}
                              Old results are hidden until the connection
                              recovers.
                            </p>
                            {!/^Connect Vercel in Connections/.test(
                              deployment.error || "",
                            ) && <p>{connectionMessage(deployment.error)}</p>}
                            <button
                              onClick={() =>
                                setModal({
                                  type: "connections",
                                  provider: "vercel",
                                })
                              }
                            >
                              {/^Connect Vercel in Connections/.test(
                                deployment.error || "",
                              )
                                ? "Connect Vercel"
                                : "Review Vercel connection"}
                            </button>
                          </div>
                        ) : (
                          <SourceStatus source={deployment} label="Vercel" />
                        )}
                        {deployment.mode === "events" && (
                          <p className="build-note">
                            Events arrive directly from Vercel, even when your
                            Mac is off. This page checks for new events every 10
                            seconds.
                          </p>
                        )}
                        {deployment?.status === "connected" &&
                          deployment.deployments.find(
                            (d) => d.state === "READY" && d.siteUrl,
                          ) && (
                            <Out
                              className="button latest-deployment"
                              href={
                                deployment.deployments.find(
                                  (d) => d.state === "READY" && d.siteUrl,
                                ).siteUrl
                              }
                            >
                              Open latest ready deployment{" "}
                              <ArrowUpRight size={16} />
                            </Out>
                          )}
                        {deployment?.status === "connected" &&
                        deployment.deployments.length ? (
                          <RunRows
                            runs={deployment?.deployments}
                            historical={deployment?.status !== "connected"}
                          />
                        ) : (
                          <p className="quiet-empty">
                            {deployment?.status === "unlinked"
                              ? "Connect a Vercel account, then choose this project’s deployment."
                              : deployment?.status === "error"
                                ? "Connect Vercel to enable updates."
                                : "No deployments found."}
                          </p>
                        )}
                      </>
                    )}
                  </section>
                </Tabs.Content>
                <Tabs.Content value="costs">
                  <div className="view-toolbar">
                    {!!data.subscriptions.length && (
                      <div className="segmented">
                        <button
                          className={allBills ? "active" : ""}
                          onClick={() => setAllBills(true)}
                        >
                          All projects
                        </button>
                        <button
                          className={!allBills ? "active" : ""}
                          onClick={() => setAllBills(false)}
                        >
                          This project
                        </button>
                      </div>
                    )}
                    <button
                      className="primary"
                      onClick={() => setModal({ type: "subscription" })}
                    >
                      <Plus size={16} />
                      Add subscription
                    </button>
                  </div>
                  {!bills.length ? (
                    <Empty icon={CreditCard} title="Know what’s due, and when">
                      Add the amount, billing period, and next payment date from
                      your bill.{" "}
                      {cloud
                        ? "Your saved records sync across devices."
                        : "Your data stays on this Mac."}
                    </Empty>
                  ) : (
                    <>
                      <div className="billing-total">
                        <span>Monthly subscriptions</span>
                        <strong>
                          {totals.length
                            ? totals
                                .map(([currency, amount]) =>
                                  money({ currency, amount }),
                                )
                                .join(" + ")
                            : "No monthly charges"}
                        </strong>
                        {bills.some((s) => s.interval !== "monthly") && (
                          <span>
                            Yearly and one-time payments are listed below.
                          </span>
                        )}
                      </div>
                      <div className="bill-table">
                        <div className="bill-header">
                          <span>Service</span>
                          <span>Amount</span>
                          <span>Next payment</span>
                          <span></span>
                        </div>
                        {bills.map((s) => (
                          <div className="bill-row" key={s.id}>
                            <div>
                              <strong>{s.name}</strong>
                              <span>
                                {s.projectId === "shared"
                                  ? "Shared across projects"
                                  : data.projects.find(
                                      (p) => p.id === s.projectId,
                                    )?.name}
                              </span>
                            </div>
                            <div>
                              <strong>{money(s)}</strong>
                              <span>
                                {s.interval === "one-time"
                                  ? "One-time"
                                  : s.interval === "yearly"
                                    ? "Per year"
                                    : "Per month"}
                              </span>
                            </div>
                            <div>
                              <strong>{fmtDate(s.nextDue)}</strong>
                              {s.nextDue < localToday() && (
                                <button
                                  className="text-button review-bill"
                                  aria-label={
                                    "Review " +
                                    s.name +
                                    " bill, due " +
                                    fmtDate(s.nextDue)
                                  }
                                  onClick={() =>
                                    setModal({
                                      type: "subscription",
                                      subscription: s,
                                    })
                                  }
                                >
                                  Review bill
                                </button>
                              )}
                            </div>
                            <button
                              className="icon-button"
                              aria-label={"Edit " + s.name}
                              onClick={() =>
                                setModal({
                                  type: "subscription",
                                  subscription: s,
                                })
                              }
                            >
                              <Pencil size={17} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <p className="billing-note">
                        Amounts and dates are manually recorded. Payment status
                        is not connected to your bank.
                      </p>
                    </>
                  )}
                </Tabs.Content>
              </div>
            </Tabs.Root>
          </>
        )}
      </main>
      {notice && (
        <div className="toast" role="status">
          <Check size={18} />
          {notice}
        </div>
      )}
      {["add", "link"].includes(modal?.type) && (
        <AddProject
          projects={data.projects}
          linking={modal.type === "link" ? project : null}
          onClose={() => setModal(null)}
          onAdded={async (p) => {
            await load();
            choose(p.id);
          }}
        />
      )}
      {modal?.type === "connections" && (
        <Connections
          project={project}
          onClose={() => setModal(null)}
          initialProvider={modal.provider}
          onLinkRepository={() => setModal({ type: "link" })}
          onSignOut={signOut}
          onSaved={async () => {
            await load();
            await refresh();
          }}
        />
      )}
      {modal?.type === "subscription" && (
        <SubscriptionForm
          subscription={modal.subscription}
          projects={data.projects}
          projectId={allBills ? "shared" : project?.id}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
      {modal?.type === "node" && (
        <Modal
          title={modal.node.name}
          description={modal.node.role + " in " + project.name}
          onClose={() => setModal(null)}
        >
          <div className="node-detail">
            <Icon name={modal.node.kind} />
            <p>
              {modal.node.detected
                ? "Found in your project."
                : "Linked in Project Hub."}{" "}
              {["GitHub", "Vercel", "GitHub Actions"].includes(modal.node.name)
                ? "Open the related view to check connection status and available results."
                : "Runtime health is not connected."}
            </p>
          </div>
          <h3>Found in</h3>
          <ul className="evidence-list">
            {modal.node.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <div className="actions">
            <button onClick={() => setModal(null)}>Done</button>
            {["GitHub", "Vercel", "GitHub Actions"].includes(
              modal.node.name,
            ) && (
              <button
                className="primary"
                onClick={() => {
                  setTab(
                    modal.node.name === "GitHub" ? "issues" : "deployments",
                  );
                  setModal(null);
                }}
              >
                Open {modal.node.name === "GitHub" ? "issues" : "deployments"}
                <ArrowUpRight size={16} />
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
