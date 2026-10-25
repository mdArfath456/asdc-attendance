import { useEffect, useState } from 'react';
import api, { errMsg } from '../../api';

export default function Audit() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/audit-logs', { params: { limit: 100 } }).then((r) => setLogs(r.data.data.items)).catch((e) => setError(errMsg(e)));
  }, []);
  return (
    <>
      <h1>Audit log</h1>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="card table-wrap"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Change</th><th>Reason</th></tr></thead>
        <tbody>{logs.map((log) => <tr key={log._id}><td>{new Date(log.createdAt).toLocaleString()}</td><td>{log.actorId?.name || 'system'}</td><td>{log.action}</td><td>{log.previousStatus ? `${log.previousStatus} → ${log.newStatus}` : log.newStatus || ''}</td><td>{log.reason || ''}</td></tr>)}
          {logs.length === 0 && <tr><td colSpan="5" className="muted">No audit entries yet.</td></tr>}</tbody></table></div>
    </>
  );
}
