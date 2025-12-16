(function () {
  const table = document.querySelector("[data-card-table]");
  const overlay = document.querySelector("[data-card-overlay]");

  if (table && overlay) {
    const closeElements = overlay.querySelectorAll("[data-card-close]");
    const alertEl = overlay.querySelector("[data-card-alert]");
    const ganEl = overlay.querySelector("[data-card-gan]");
    const stateEl = overlay.querySelector("[data-card-state]");
    const createdEl = overlay.querySelector("[data-card-created]");
    const balanceEl = overlay.querySelector("[data-card-balance]");
    const reasonInput = overlay.querySelector("[data-card-reason]");
    const blockBtn = overlay.querySelector("[data-action-block]");
    const unblockBtn = overlay.querySelector("[data-action-unblock]");
    const adjustForm = overlay.querySelector("[data-action-adjust]");
    const adjustAmountInput = overlay.querySelector("[data-adjust-amount]");
    const adjustCurrencyInput = overlay.querySelector("[data-adjust-currency]");
    const adjustReasonInput = overlay.querySelector("[data-adjust-reason]");
    const activityList = overlay.querySelector("[data-card-activities]");

    let currentCardId = null;

    const setAlert = (message, tone = "error") => {
      if (!message) {
        alertEl.hidden = true;
        alertEl.textContent = "";
        alertEl.classList.remove("card-overlay__alert--success");
        alertEl.classList.remove("card-overlay__alert--error");
        return;
      }
      alertEl.textContent = message;
      alertEl.classList.toggle(
        "card-overlay__alert--success",
        tone === "success",
      );
      alertEl.classList.toggle(
        "card-overlay__alert--error",
        tone !== "success",
      );
      alertEl.hidden = false;
    };

    const openOverlay = () => {
      overlay.classList.add("is-visible");
      document.body.classList.add("no-scroll");
    };

    const closeOverlay = () => {
      overlay.classList.remove("is-visible");
      document.body.classList.remove("no-scroll");
      setAlert(null);
      currentCardId = null;
    };

    closeElements.forEach((el) =>
      el.addEventListener("click", () => closeOverlay()),
    );

    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeOverlay();
      }
    });

    const renderActivities = (activities = []) => {
      if (!activities.length) {
        activityList.innerHTML = "<li>No recent activity.</li>";
        return;
      }
      const formatter = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
      });
      activityList.innerHTML = activities
        .map((activity) => {
          const amount =
            activity.amount && typeof activity.amount.amount === "number"
              ? formatter.format(activity.amount.amount / 100)
              : "—";
          const created = activity.createdAt
            ? new Date(activity.createdAt).toLocaleString()
            : "—";
          return `<li>
          <div>
            <span class="activity-type">${activity.type}</span>
            <span class="activity-meta">${created}</span>
          </div>
          <div>
            <strong>${amount}</strong>
            <span class="activity-meta">Balance: ${
              activity.balance && typeof activity.balance.amount === "number"
                ? formatter.format(activity.balance.amount / 100)
                : "—"
            }</span>
          </div>
        </li>`;
        })
        .join("");
    };

    const renderCard = ({ card, activities }) => {
      const formatter = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: card.balance.currency || "USD",
        minimumFractionDigits: 2,
      });
      ganEl.textContent = card.gan || card.id;
      stateEl.textContent = card.state || "—";
      createdEl.textContent = card.createdAt
        ? new Date(card.createdAt).toLocaleString()
        : "—";
      balanceEl.textContent = formatter.format(
        (card.balance.amount || 0) / 100,
      );
      blockBtn.hidden =
        card.state === "BLOCKED" || card.state === "DEACTIVATED";
      unblockBtn.hidden = card.state !== "BLOCKED";
      reasonInput.value = "";
      adjustAmountInput.value = "";
      adjustReasonInput.value = "";
      adjustCurrencyInput.value = card.balance.currency || "USD";
      renderActivities(activities);
    };

    const loadCard = async (cardId) => {
      setAlert(null);
      overlay.classList.add("is-loading");
      try {
        const response = await fetch(`/gift-cards/${cardId}/detail`);
        if (!response.ok) {
          throw new Error("Unable to load card");
        }
        const payload = await response.json();
        currentCardId = cardId;
        renderCard(payload);
        openOverlay();
      } catch (error) {
        setAlert(error.message || "Failed to load card");
      } finally {
        overlay.classList.remove("is-loading");
      }
    };

    table.addEventListener("click", (event) => {
      const row = event.target.closest("[data-card-row]");
      if (!row) return;
      event.preventDefault();
      loadCard(row.dataset.cardId);
    });

    const postAction = async (path, body = {}) => {
      if (!currentCardId) return;
      setAlert(null);
      try {
        const response = await fetch(`/gift-cards/${currentCardId}/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "Request failed");
        }
        setAlert("Action completed", "success");
        await loadCard(currentCardId);
      } catch (error) {
        setAlert(error.message || "Action failed");
      }
    };

    blockBtn?.addEventListener("click", () => {
      postAction("block", { reason: reasonInput.value });
    });

    unblockBtn?.addEventListener("click", () => {
      postAction("unblock", { reason: reasonInput.value });
    });

    adjustForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const amount = adjustAmountInput.value;
      if (!amount) {
        setAlert("Provide an adjustment amount");
        return;
      }
      postAction("adjust", {
        amount,
        currency: adjustCurrencyInput.value || "USD",
        reason: adjustReasonInput.value,
      });
    });
  }

  const filterForm = document.querySelector("[data-filter-form]");
  const savePresetBtn = document.querySelector("[data-save-preset]");
  const customPresetContainer = document.querySelector("[data-custom-presets]");
  const presetStorageKey = "giftCardFilterPresets";

  if (filterForm && customPresetContainer) {
    const loadPresets = () => {
      try {
        const raw = localStorage.getItem(presetStorageKey);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    };

    let presets = loadPresets();

    const persistPresets = () => {
      localStorage.setItem(presetStorageKey, JSON.stringify(presets));
    };

    const renderPresets = () => {
      customPresetContainer.innerHTML = "";
      if (!presets.length) {
        const empty = document.createElement("span");
        empty.className = "preset-empty";
        empty.textContent = "No custom presets yet.";
        customPresetContainer.appendChild(empty);
        return;
      }
      presets.forEach((preset) => {
        const chip = document.createElement("div");
        chip.className = "preset-chip";
        const applyBtn = document.createElement("button");
        applyBtn.type = "button";
        applyBtn.className = "button button-ghost";
        applyBtn.dataset.applyPreset = "true";
        applyBtn.dataset.presetQuery = preset.query;
        applyBtn.textContent = preset.name;
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "preset-remove";
        removeBtn.dataset.removePreset = preset.id;
        removeBtn.textContent = "×";
        chip.append(applyBtn, removeBtn);
        customPresetContainer.appendChild(chip);
      });
    };

    const serializeCurrentFilters = () => {
      const data = new FormData(filterForm);
      const params = new URLSearchParams();
      data.forEach((value, key) => {
        if (!value) return;
        params.append(key, value);
      });
      return params.toString();
    };

    savePresetBtn?.addEventListener("click", () => {
      const query = serializeCurrentFilters();
      if (!query) {
        alert("Set at least one filter before saving.");
        return;
      }
      const name = prompt("Preset name");
      if (!name) return;
      const preset = {
        id:
          (window.crypto && window.crypto.randomUUID
            ? window.crypto.randomUUID()
            : Date.now().toString()) || Date.now().toString(),
        name: name.trim(),
        query,
      };
      presets = [preset, ...presets].slice(0, 8);
      persistPresets();
      renderPresets();
    });

    customPresetContainer.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-remove-preset]");
      if (remove) {
        presets = presets.filter(
          (preset) => preset.id !== remove.dataset.removePreset,
        );
        persistPresets();
        renderPresets();
        return;
      }
      const apply = event.target.closest("[data-apply-preset]");
      if (apply) {
        const base = filterForm.getAttribute("action") || "/gift-cards";
        window.location.href = `${base}?${apply.dataset.presetQuery}`;
      }
    });

    renderPresets();
  }
})();
