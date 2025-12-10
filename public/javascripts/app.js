// Modern Chart Configurations
const chartConfig = {
  // Shared chart options
  defaults: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        titleColor: "rgba(255, 255, 255, 0.9)",
        bodyColor: "rgba(255, 255, 255, 0.9)",
        padding: 12,
        borderColor: "rgba(255, 255, 255, 0.1)",
        borderWidth: 1,
      },
    },
  },

  // Line chart options
  line: {
    tension: 0.4,
    fill: true,
    pointRadius: 0,
    pointHoverRadius: 6,
    pointBackgroundColor: "#00D54B",
    pointHoverBackgroundColor: "#00D54B",
    pointBorderWidth: 2,
    pointHoverBorderWidth: 2,
    pointBorderColor: "#000000",
    gradient: {
      backgroundColor: {
        axis: "y",
        colors: {
          0: "rgba(0, 213, 75, 0.1)",
          100: "rgba(0, 213, 75, 0)",
        },
      },
    },
  },

  // Bar chart options
  bar: {
    borderRadius: 4,
    maxBarThickness: 32,
  },
};

// Initialize Dashboard Charts
function initDashboardCharts() {
  // Balance Chart
  const balanceCtx = document.getElementById("balanceChart").getContext("2d");
  new Chart(balanceCtx, {
    type: "line",
    data: {
      labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
      datasets: [
        {
          label: "Balance",
          data: [30000, 35000, 32000, 37000, 42000, 45000],
          borderColor: "#00D54B",
          ...chartConfig.line,
        },
      ],
    },
    options: {
      ...chartConfig.defaults,
      scales: {
        y: {
          beginAtZero: true,
          grid: {
            color: "rgba(255, 255, 255, 0.05)",
          },
        },
        x: {
          grid: {
            display: false,
          },
        },
      },
    },
  });

  // Cash Flow Chart
  const cashFlowCtx = document.getElementById("cashFlowChart").getContext("2d");
  new Chart(cashFlowCtx, {
    type: "bar",
    data: {
      labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      datasets: [
        {
          label: "Income",
          data: [5000, 7000, 4000, 6000, 8000, 3000, 9000],
          backgroundColor: "#00D54B",
          ...chartConfig.bar,
        },
        {
          label: "Expenses",
          data: [4000, 5000, 3000, 4000, 6000, 2000, 7000],
          backgroundColor: "rgba(255, 59, 48, 0.5)",
          ...chartConfig.bar,
        },
      ],
    },
    options: {
      ...chartConfig.defaults,
      scales: {
        y: {
          beginAtZero: true,
          grid: {
            color: "rgba(255, 255, 255, 0.05)",
          },
        },
        x: {
          grid: {
            display: false,
          },
        },
      },
    },
  });
}

// Modern Search Implementation
function initSearch() {
  const searchInput = document.querySelector(".search-input");
  const debounce = (fn, delay) => {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), delay);
    };
  };

  const performSearch = debounce(async (query) => {
    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(query)}`,
      );
      const results = await response.json();
      updateSearchResults(results);
    } catch (error) {
      console.error("Search failed:", error);
    }
  }, 300);

  searchInput?.addEventListener("input", (e) => performSearch(e.target.value));
}

// Interactive Data Tables
function initDataTables() {
  const tables = document.querySelectorAll(".table");

  tables.forEach((table) => {
    const rows = table.querySelectorAll("tbody tr");

    rows.forEach((row) => {
      row.addEventListener("click", () => {
        const id = row.dataset.id;
        if (id) {
          window.location.href = `/details/${id}`;
        }
      });
    });

    // Sort functionality
    const headers = table.querySelectorAll("th[data-sortable]");
    headers.forEach((header) => {
      header.addEventListener("click", () => {
        const column = header.dataset.column;
        const isAsc = header.classList.contains("asc");

        // Reset all headers
        headers.forEach((h) => h.classList.remove("asc", "desc"));

        // Set new sort direction
        header.classList.add(isAsc ? "desc" : "asc");

        // Sort the table
        sortTable(table, column, !isAsc);
      });
    });
  });
}

// Initialize all interactive features
document.addEventListener("DOMContentLoaded", () => {
  initDashboardCharts();
  initSearch();
  initDataTables();

  // Initialize tooltips
  const tooltips = document.querySelectorAll("[data-tooltip]");
  tooltips.forEach((element) => {
    tippy(element, {
      content: element.dataset.tooltip,
      animation: "shift-away",
      theme: "modern-dark",
    });
  });

  // Initialize dropdowns
  const dropdowns = document.querySelectorAll(".nav-dropdown");
  dropdowns.forEach((dropdown) => {
    const trigger = dropdown.querySelector(".dropdown-trigger");
    trigger?.addEventListener("click", () => {
      dropdown.classList.toggle("active");
    });
  });
});
