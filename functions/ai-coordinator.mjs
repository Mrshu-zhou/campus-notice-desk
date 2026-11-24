const TABLE = "ai_coordinator";
const FIELDS = "lock_key,payload,lease_owner,lease_expires_at,version,updated_at";

export class CoordinatorError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.name = "CoordinatorError";
    this.code = code;
    this.status = status;
  }
}

function unavailable() {
  return new CoordinatorError("ai_initialization_unavailable", 503);
}

function conflict() {
  return new CoordinatorError("ai_initialization_conflict", 409);
}

function rows(result) {
  if (!result || result.error) throw unavailable();
  if (!Array.isArray(result.data)) throw unavailable();
  return result.data;
}

function decodePayload(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      throw unavailable();
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) return value;
  throw unavailable();
}

function expiry(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createAiCoordinator({
  db,
  table = TABLE,
  leaseMs = 120_000,
  waitMs = 8_000,
} = {}) {
  if (!db || typeof db.from !== "function" || !Number.isInteger(leaseMs) || leaseMs < 10_000 || leaseMs > 600_000) {
    throw new CoordinatorError("ai_configuration_invalid", 503);
  }

  const from = () => db.from(table);

  async function readRow(key) {
    const result = await from().select(FIELDS).eq("lock_key", key).limit(1);
    const found = rows(result);
    if (found.length === 0) return null;
    const row = found[0];
    if (!row || row.lock_key !== key || !Number.isInteger(row.version) || row.version < 1) throw unavailable();
    return row;
  }

  function held(row, owner, version) {
    return Boolean(
      row
      && row.lease_owner === owner
      && row.version === version
      && expiry(row.lease_expires_at) > Date.now(),
    );
  }

  async function acquire(key, owner) {
    const startedAt = Date.now();
    while (true) {
      const current = await readRow(key);
      if (!current) {
        const inserted = rows(await from().insertIfAbsent({
          lock_key: key,
          payload: null,
          lease_owner: owner,
          lease_expires_at: new Date(Date.now() + leaseMs).toISOString(),
          version: 1,
          updated_at: new Date().toISOString(),
        }, { onConflict: "lock_key" }).select(FIELDS));
        if (inserted.length === 1 && inserted[0]?.lock_key === key) return inserted[0].version;
      } else if (!current.lease_owner || expiry(current.lease_expires_at) <= Date.now()) {
        const now = Date.now();
        const updated = rows(await from().update({
          lease_owner: owner,
          lease_expires_at: new Date(now + leaseMs).toISOString(),
          version: current.version + 1,
          updated_at: new Date(now).toISOString(),
        }).eq("lock_key", key).eq("version", current.version).select(FIELDS));
        if (updated.length === 1) return updated[0].version;
      }
      if (Date.now() - startedAt >= waitMs) throw new CoordinatorError("ai_initialization_pending", 202);
      await new Promise((resolve) => setTimeout(resolve, 160 + Math.floor(Math.random() * 140)));
    }
  }

  async function withLock(key, callback) {
    if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key) || typeof callback !== "function") {
      throw new CoordinatorError("ai_configuration_invalid", 503);
    }
    const owner = `fn_${crypto.randomUUID()}`;
    let version = await acquire(key, owner);

    async function requireHeld() {
      const current = await readRow(key);
      if (!held(current, owner, version)) throw conflict();
    }

    const lease = {
      async read() {
        const current = await readRow(key);
        if (!held(current, owner, version)) throw conflict();
        return decodePayload(current.payload);
      },
      async write(payload) {
        const current = await readRow(key);
        if (!held(current, owner, version)) throw conflict();
        const next = version + 1;
        const now = Date.now();
        const updated = rows(await from().update({
          payload,
          lease_owner: owner,
          lease_expires_at: new Date(now + leaseMs).toISOString(),
          version: next,
          updated_at: new Date(now).toISOString(),
        }).eq("lock_key", key).eq("lease_owner", owner).eq("version", version).select(FIELDS));
        if (updated.length !== 1) throw conflict();
        version = next;
      },
      async assertHeld() {
        await requireHeld();
        const current = await readRow(key);
        if (!held(current, owner, version)) throw conflict();
        const next = version + 1;
        const now = Date.now();
        const updated = rows(await from().update({
          lease_owner: owner,
          lease_expires_at: new Date(now + leaseMs).toISOString(),
          version: next,
          updated_at: new Date(now).toISOString(),
        }).eq("lock_key", key).eq("lease_owner", owner).eq("version", version).select(FIELDS));
        if (updated.length !== 1) throw conflict();
        version = next;
      },
      async release() {
        const current = await readRow(key);
        if (!current || current.lease_owner !== owner || current.version !== version) return;
        await from().update({
          lease_owner: null,
          lease_expires_at: null,
          version: version + 1,
          updated_at: new Date().toISOString(),
        }).eq("lock_key", key).eq("lease_owner", owner).eq("version", version).select(FIELDS);
      },
    };

    try {
      return await callback(lease);
    } finally {
      try {
        await lease.release();
      } catch {
        // An expired or fenced lease must not be extended by its former owner.
      }
    }
  }

  return Object.freeze({ withLock });
}