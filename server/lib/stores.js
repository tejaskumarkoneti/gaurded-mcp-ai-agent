import { EventEmitter } from "node:events";
import { watch } from "node:fs";
import { readJson, writeJson } from "./fileStore.js";

export class JsonStore extends EventEmitter {
  constructor(file, fallback) {
    super();
    this.file = file;
    this.fallback = fallback;
  }

  async get() {
    return readJson(this.file, this.fallback);
  }

  async set(value) {
    await writeJson(this.file, value);
    this.emit("change", value);
    return value;
  }

  watch() {
    watch(this.file, async () => this.emit("change", await this.get()));
  }
}

export class LogStore {
  constructor(file) {
    this.file = file;
  }

  async append(type, payload) {
    const logs = await readJson(this.file, []);
    const entry = { id: crypto.randomUUID(), at: new Date().toISOString(), type, ...payload };
    logs.unshift(entry);
    await writeJson(this.file, logs.slice(0, 500));
    return entry;
  }

  list() {
    return readJson(this.file, []);
  }
}

export class ApprovalStore {
  constructor(file) {
    this.file = file;
  }

  list() {
    return readJson(this.file, []);
  }

  async create(request) {
    const approvals = await this.list();
    const row = { id: crypto.randomUUID(), status: "pending", createdAt: new Date().toISOString(), ...request };
    approvals.unshift(row);
    await writeJson(this.file, approvals);
    return row;
  }

  async resolve(id, status) {
    const approvals = await this.list();
    const next = approvals.map((item) => item.id === id ? { ...item, status, resolvedAt: new Date().toISOString() } : item);
    await writeJson(this.file, next);
    return next.find((item) => item.id === id);
  }
}
