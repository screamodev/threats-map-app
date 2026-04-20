import type { WsMessage, LiveIncident, DistrictRiskPayload } from './types';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
type StatusListener = (status: ConnectionStatus) => void;
type SnapshotListener = (incidents: LiveIncident[]) => void;
type NewListener = (incident: LiveIncident) => void;
type UpdateListener = (incident: LiveIncident) => void;
type ExpireListener = (id: string) => void;
type DistrictRiskListener = (payload: DistrictRiskPayload) => void;

const MAX_BACKOFF = 30_000;

let ws: WebSocket | null = null;
let backoff = 1000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let status: ConnectionStatus = 'disconnected';

const statusListeners: StatusListener[] = [];
const snapshotListeners: SnapshotListener[] = [];
const newListeners: NewListener[] = [];
const updateListeners: UpdateListener[] = [];
const expireListeners: ExpireListener[] = [];
const districtRiskListeners: DistrictRiskListener[] = [];

function setStatus(s: ConnectionStatus) {
  status = s;
  for (const fn of statusListeners) fn(s);
}

function getWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/live`;
}

function connect() {
  if (ws) return;
  setStatus('connecting');

  ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    backoff = 1000;
    setStatus('connected');
  };

  ws.onmessage = (ev) => {
    try {
      const msg: WsMessage = JSON.parse(ev.data);
      switch (msg.type) {
        case 'snapshot':
          for (const fn of snapshotListeners) fn(msg.payload);
          break;
        case 'incident:new':
          for (const fn of newListeners) fn(msg.payload);
          break;
        case 'incident:update':
          for (const fn of updateListeners) fn(msg.payload);
          break;
        case 'incident:expire':
          for (const fn of expireListeners) fn(msg.payload.id);
          break;
        case 'districts:risk':
          for (const fn of districtRiskListeners) fn(msg.payload);
          break;
        case 'ping':
          ws?.send(JSON.stringify({ type: 'pong' }));
          break;
      }
    } catch {
      // ignore malformed
    }
  };

  ws.onclose = () => {
    ws = null;
    setStatus('disconnected');
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    backoff = Math.min(backoff * 2, MAX_BACKOFF);
    connect();
  }, backoff);
}

export function startConnection() {
  connect();
}

export function getStatus(): ConnectionStatus {
  return status;
}

export function onStatus(fn: StatusListener) { statusListeners.push(fn); }
export function onSnapshot(fn: SnapshotListener) { snapshotListeners.push(fn); }
export function onNewIncident(fn: NewListener) { newListeners.push(fn); }
export function onUpdateIncident(fn: UpdateListener) { updateListeners.push(fn); }
export function onExpireIncident(fn: ExpireListener) { expireListeners.push(fn); }
export function onDistrictRisk(fn: DistrictRiskListener) { districtRiskListeners.push(fn); }
