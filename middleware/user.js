const ROLE_PRIORITY = ["viewer", "analyst", "finance", "admin"];

const normalizeRole = (value) => {
  if (!value || typeof value !== "string") return "viewer";
  const lowered = value.toLowerCase();
  if (ROLE_PRIORITY.includes(lowered)) {
    return lowered;
  }
  return "viewer";
};

const roleWeight = (role) => ROLE_PRIORITY.indexOf(normalizeRole(role));

const hasRole = (user, role) => {
  if (!user) return false;
  return roleWeight(user.role) >= roleWeight(role);
};

const attachUserContext = (req, res, next) => {
  const headerUser = req.get("x-cashly-user-name");
  const headerEmail = req.get("x-cashly-user-email");
  const headerId = req.get("x-cashly-user-id");
  const headerRole = req.get("x-cashly-role");

  const user = {
    id: headerId || headerEmail || headerUser || "anonymous",
    name: headerUser || process.env.DEFAULT_USER_NAME || "Ops Analyst",
    email: headerEmail || process.env.DEFAULT_USER_EMAIL || "ops@example.com",
    role:
      normalizeRole(headerRole || process.env.DEFAULT_USER_ROLE || "viewer") ||
      "viewer",
  };

  req.user = user;
  res.locals.currentUser = user;
  res.locals.permissions = {
    canManageGiftCards: hasRole(user, "finance"),
    canAuditGiftCards: hasRole(user, "analyst"),
  };

  next();
};

const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const allowed = roles.some((role) => hasRole(req.user, role));
    if (!allowed) {
      if (req.accepts("html")) {
        return res.status(403).render("error", {
          status: 403,
          message: "Restricted area",
          error: "You do not have permission to perform this action.",
        });
      }
      return res.status(403).json({ message: "Forbidden" });
    }
    return next();
  };

module.exports = {
  attachUserContext,
  requireRole,
  hasRole,
};
