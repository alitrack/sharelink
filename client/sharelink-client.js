// sharelink-client — browser SDK for a ShareLink worker.
// Usage:
//   const share = new ShareLink("https://share.example.com");
//   const { id, ownerToken, url } = await share.put("myapp", gzipBundle);
//   const blob = await share.get("myapp", id);
//   const meta = await share.meta("myapp", id);
//   await share.remove("myapp", id, ownerToken);

export class ShareLink {
  constructor(base, ns = "default") {
    this.base = base.replace(/\/+$/, "");
    this.ns = ns;
  }

  async check(size) {
    const r = await fetch(`${this.base}/s/${this.ns}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ size }),
    });
    if (!r.ok) throw new Error(`check failed: ${r.status}`);
    return r.json();
  }

  // opts: { id?: client-chosen blob id (X-ShareLink-Id, idempotent overwrite), ns? }
  async put(data, opts = {}) {
    const ns = opts.ns ?? this.ns;
    const headers = {};
    if (opts.id) headers["X-ShareLink-Id"] = opts.id;
    const body = data instanceof Blob ? data : new Blob([data]);
    const r = await fetch(`${this.base}/s/${ns}`, { method: "POST", headers, body });
    if (!r.ok) throw new Error(`put failed: ${r.status} ${await r.text()}`);
    return r.json(); // { id, ns, ownerToken, url }
  }

  async get(id, ns = this.ns) {
    const r = await fetch(`${this.base}/s/${ns}/${id}`);
    if (!r.ok) throw new Error(`get failed: ${r.status}`);
    return r.arrayBuffer();
  }

  async getOrNull(id, ns = this.ns) {
    const r = await fetch(`${this.base}/s/${ns}/${id}`);
    return r.ok ? r.arrayBuffer() : null;
  }

  async meta(id, ns = this.ns) {
    const r = await fetch(`${this.base}/s/${ns}/${id}/meta`);
    if (!r.ok) throw new Error(`meta failed: ${r.status}`);
    return r.json();
  }

  async remove(id, ownerToken, ns = this.ns) {
    const r = await fetch(`${this.base}/s/${ns}/${id}?token=${encodeURIComponent(ownerToken)}`, {
      method: "DELETE",
    });
    if (!r.ok) throw new Error(`remove failed: ${r.status}`);
    return true;
  }
}
