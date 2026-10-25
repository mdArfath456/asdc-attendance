const COLORS = { PRESENT: 'green', LATE: 'amber', ABSENT: 'red', EXCUSED: 'blue', OPEN: 'green', CLOSED: 'gray', CANCELLED: 'red', SCHEDULED: 'blue', ACTIVE: 'green' };
export default function Badge({ value }) {
  return <span className={`badge ${COLORS[value] || 'gray'}`}>{value}</span>;
}
