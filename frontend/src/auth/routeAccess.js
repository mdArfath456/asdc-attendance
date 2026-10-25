export function protectedRouteDecision(user, roles) {
  if (!user) return 'redirect';
  if (roles && !roles.includes(user.role)) return 'denied';
  return 'allow';
}
