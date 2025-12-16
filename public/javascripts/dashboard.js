document.addEventListener("DOMContentLoaded", function () {
  var drawer = document.querySelector(".command-drawer");
  var drawerPanel = drawer
    ? drawer.querySelector(".command-drawer__panel")
    : null;
  var sidebarOverlay = document.querySelector(".sidebar-overlay");
  var trigger = document.querySelector(".hero__nav-trigger");
  var closeBtn = document.querySelector(".command-drawer__close");
  var profileBtn = document.querySelector(".hero__profile-trigger");
  var profileDropdown = document.querySelector(".profile-dropdown");
  var announcer = document.getElementById("sr-announcer");
  var helpOverlay = document.querySelector("[data-help-overlay]");
  var helpDismiss = helpOverlay
    ? helpOverlay.querySelector("[data-help-dismiss]")
    : null;
  var helpHide = helpOverlay
    ? helpOverlay.querySelector("[data-help-hide]")
    : null;
  var HELP_KEY = "cashly-help-dismissed";
  var focusableSelectors =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var drawerFocusables = [];
  var previousFocus = null;
  var toggleDrawer = function (shouldOpen) {
    if (!drawer) return;
    if (shouldOpen) {
      previousFocus = document.activeElement;
      drawer.classList.add("is-open");
      document.body.classList.add("drawer-open");
      if (drawerPanel) {
        drawerPanel.style.animation = "drawerSlide 0.4s ease forwards";
      }
    } else {
      if (drawerPanel) {
        drawerPanel.style.animation = "drawerSlideOut 0.3s ease forwards";
      }
      drawer.classList.remove("is-open");
      document.body.classList.remove("drawer-open");
    }
    drawer.setAttribute("aria-hidden", shouldOpen ? "false" : "true");
    if (trigger) {
      trigger.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    }
    if (shouldOpen) {
      drawerFocusables = drawerPanel
        ? Array.prototype.slice.call(
            drawerPanel.querySelectorAll(focusableSelectors),
          )
        : [];
      if (drawerFocusables.length) {
        drawerFocusables[0].focus();
      }
      announce("Navigation drawer opened");
    } else {
      drawerFocusables = [];
      if (previousFocus && typeof previousFocus.focus === "function") {
        previousFocus.focus();
      }
      announce("Navigation drawer closed");
    }
  };
  var toggleProfile = function (shouldOpen) {
    if (!profileBtn || !profileDropdown) return;
    if (shouldOpen) {
      profileDropdown.classList.add("is-visible");
      profileBtn.setAttribute("aria-expanded", "true");
    } else {
      profileDropdown.classList.remove("is-visible");
      profileBtn.setAttribute("aria-expanded", "false");
    }
  };
  var toggleSidebar = function (shouldOpen) {
    if (window.innerWidth >= 992 && typeof shouldOpen === "undefined") {
      document.body.classList.toggle("sidebar-collapsed");
      return;
    }
    var isOpen = document.body.classList.contains("sidebar-open");
    if (shouldOpen === undefined) {
      shouldOpen = !isOpen;
    }
    if (shouldOpen) {
      document.body.classList.add("sidebar-open");
    } else {
      document.body.classList.remove("sidebar-open");
    }
  };

  if (trigger) {
    trigger.addEventListener("click", function () {
      toggleDrawer(true);
      toggleSidebar();
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      toggleDrawer(false);
    });
  }
  if (drawer) {
    drawer.addEventListener("click", function (event) {
      if (event.target === drawer) {
        toggleDrawer(false);
      }
    });
    drawer.addEventListener("keydown", function (event) {
      if (event.key !== "Tab" || !drawerFocusables.length) return;
      var first = drawerFocusables[0];
      var last = drawerFocusables[drawerFocusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener("click", function () {
      toggleSidebar(false);
    });
  }
  if (profileBtn) {
    profileBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      var isOpen =
        profileDropdown && profileDropdown.classList.contains("is-visible");
      toggleProfile(!isOpen);
    });
  }
  document.addEventListener("keydown", function (event) {
    var isMeta = event.metaKey || event.ctrlKey;
    if (event.key === "Escape") {
      if (drawer && drawer.classList.contains("is-open")) {
        toggleDrawer(false);
      }
      if (profileDropdown && profileDropdown.classList.contains("is-visible")) {
        toggleProfile(false);
      }
    }
    if (isMeta && !event.shiftKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      toggleDrawer(true);
      if (!document.body.classList.contains("sidebar-open")) {
        toggleSidebar(true);
      }
      trigger && trigger.focus();
    }
  });
  document.addEventListener("click", function (event) {
    if (
      profileDropdown &&
      profileDropdown.classList.contains("is-visible") &&
      !profileDropdown.contains(event.target) &&
      event.target !== profileBtn
    ) {
      toggleProfile(false);
    }
  });
  var ticker = document.querySelector(".hero__ticker");
  var tickerTrack = ticker ? ticker.querySelector(".ticker-track") : null;
  if (ticker && tickerTrack) {
    var prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!prefersReducedMotion) {
      var tickerItems = Array.prototype.slice.call(
        tickerTrack.querySelectorAll(".ticker-item"),
      );
      if (tickerItems.length) {
        tickerItems.forEach(function (item) {
          item.setAttribute("aria-hidden", "false");
        });
        tickerItems.forEach(function (item) {
          var clone = item.cloneNode(true);
          clone.setAttribute("aria-hidden", "true");
          tickerTrack.appendChild(clone);
        });
        ticker.setAttribute("data-enhanced", "true");
      }
    }
  }
  var toast = document.querySelector("[data-toast]");
  var toastMessage = toast ? toast.querySelector(".toast-message") : null;
  var toastProgress = toast ? toast.querySelector(".toast-progress__bar") : null;
  var toastClose = toast ? toast.querySelector(".toast-close") : null;
  var dashboard = document.querySelector(".dashboard[data-reminders]");
  var showReminderToast = function (message) {
    if (!toast || !toastMessage) return;
    toastMessage.textContent = message;
    if (toastProgress) {
      toastProgress.style.animation = "none";
      // trigger reflow to restart animation
      void toastProgress.offsetWidth;
      toastProgress.style.animation = "";
      toastProgress.classList.add("running");
    }
    toast.classList.add("is-visible");
    setTimeout(function () {
      toast.classList.remove("is-visible");
      toastProgress && toastProgress.classList.remove("running");
    }, 4000);
  };
  if (toastClose) {
    toastClose.addEventListener("click", function () {
      toast.classList.remove("is-visible");
    });
  }
  if (dashboard) {
    var reminderCount = Number(dashboard.getAttribute("data-reminders"));
    var previousStored = localStorage.getItem("cashly-reminder-count");
    var previousReminderCount = Number(previousStored);
    var hasPrevious =
      previousStored !== null && !Number.isNaN(previousReminderCount);
    if (
      !Number.isNaN(reminderCount) &&
      reminderCount >= 0 &&
      hasPrevious &&
      previousReminderCount !== reminderCount
    ) {
      showReminderToast(
        "Reminder queue updated — " + reminderCount + " items pending.",
      );
      announce("Reminder queue updated");
    }
    if (!Number.isNaN(reminderCount)) {
      localStorage.setItem("cashly-reminder-count", reminderCount);
    }
  }

  var showHelp = function () {
    if (!helpOverlay) return;
    if (localStorage.getItem(HELP_KEY)) return;
    helpOverlay.classList.add("is-visible");
    helpOverlay.setAttribute("aria-hidden", "false");
  };

  var hideHelp = function (persist) {
    if (!helpOverlay) return;
    helpOverlay.classList.remove("is-visible");
    helpOverlay.setAttribute("aria-hidden", "true");
    if (persist) {
      localStorage.setItem(HELP_KEY, "1");
    }
  };

  if (helpDismiss) {
    helpDismiss.addEventListener("click", function () {
      hideHelp(true);
    });
  }
  if (helpHide) {
    helpHide.addEventListener("click", function () {
      hideHelp(false);
    });
  }

  setTimeout(showHelp, 1200);

  function announce(message) {
    if (!announcer) return;
    announcer.textContent = "";
    window.setTimeout(function () {
      announcer.textContent = message;
    }, 50);
  }

  document.querySelectorAll("[data-confirm]").forEach(function (element) {
    element.addEventListener("click", function (event) {
      var message = element.getAttribute("data-confirm") || "Are you sure?";
      if (!window.confirm(message)) {
        event.preventDefault();
      }
    });
  });

  function showToast(message, tone) {
    var stack = document.getElementById("toast-stack");
    if (!stack) return;
    var toast = document.createElement("div");
    toast.className = "toast" + (tone ? " toast--" + tone : "");
    toast.textContent = message;
    stack.appendChild(toast);
    setTimeout(function () {
      toast.classList.add("is-visible");
    }, 20);
    setTimeout(function () {
      toast.classList.remove("is-visible");
      setTimeout(function () {
        stack.removeChild(toast);
      }, 250);
    }, 3200);
  }

  document.querySelectorAll("[data-run-reminders]").forEach(function (button) {
    button.addEventListener("click", function (event) {
      event.preventDefault();
      var message =
        button.getAttribute("data-confirm") ||
        "Run the reminder queue now? This sends due notices.";
      if (!window.confirm(message)) return;
      fetch("/admin/reminders/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      })
        .then(function (res) {
          if (!res.ok) {
            throw new Error("Failed to run queue");
          }
          showToast("Reminder queue triggered", "success");
        })
        .catch(function () {
          showToast("Reminder queue failed", "danger");
        });
    });
  });
});
