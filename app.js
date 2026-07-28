const API_BASE_URL = (() => {
  if (window.location.protocol.startsWith("http") && window.location.port !== "3000") {
    const appPath = window.location.pathname.endsWith("/")
      ? window.location.pathname.replace(/\/$/, "")
      : window.location.pathname.replace(/\/[^/]*$/, "");
    return `${window.location.origin}${appPath}/api.php`;
  }

  return "http://localhost:3000/api";
})();
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MEMBER_NUMBER_PREFIX = "GKPI-PKU-KOTA";

let SECTORS = [
  "PANAM 1",
  "PANAM 2",
  "SELATAN 1",
  "SELATAN 2",
  "SELATAN 3",
  "SIDOMULYO",
  "BUDIUTOMO",
  "BARAT",
  "TAMPAN",
  "KHUSUS",
  "JERUSALEM",
];

let state = {
  newMembers: [],
  members: [],
  leftMembers: [],
  syncError: ""
};

const fields = [
  "number",
  "name",
  "status",
  "gender",
  "address",
  "sector",
  "birthDate",
  "baptismDate",
  "confirmationDate",
  "marriageDate",
];

const els = {
  tabs: document.querySelectorAll(".tab"),
  panels: document.querySelectorAll(".tab-panel"),
  sectorFilter: document.querySelector("#sector-filter"),
  sectorSummary: document.querySelector("#sector-summary"),
  activeSectorLabel: document.querySelector("#active-sector-label"),
  newMemberForm: document.querySelector("#new-member-form"),
  familyMemberForm: document.querySelector("#family-member-form"),
  leavingForm: document.querySelector("#leaving-form"),
  editMemberForm: document.querySelector("#edit-member-form"),
  editDialog: document.querySelector("#edit-dialog"),
  editCancel: document.querySelector("#edit-cancel"),
  newMemberTable: document.querySelector("#new-member-table"),
  memberTable: document.querySelector("#member-table"),
  movedTable: document.querySelector("#moved-table"),
  deceasedTable: document.querySelector("#deceased-table"),
  movedDateFrom: document.querySelector("#moved-date-from"),
  movedDateTo: document.querySelector("#moved-date-to"),
  deceasedDateFrom: document.querySelector("#deceased-date-from"),
  deceasedDateTo: document.querySelector("#deceased-date-to"),
  newMemberDateFrom: document.querySelector("#new-member-date-from"),
  newMemberDateTo: document.querySelector("#new-member-date-to"),
  dashboardYear: document.querySelector("#dashboard-year"),
  dashboardYearLabel: document.querySelector("#dashboard-year-label"),
  memberChart: document.querySelector("#member-chart"),
  memberChartLegend: document.querySelector("#member-chart-legend"),
  yearChart: document.querySelector("#year-chart"),
  yearChartLegend: document.querySelector("#year-chart-legend"),
  existingFamily: document.querySelector("#existing-family"),
  leavingMember: document.querySelector("#leaving-member"),
  selectedMemberCard: document.querySelector("#selected-member-card"),
  processNewMembers: document.querySelector("#process-new-members"),
  loadLeavingMember: document.querySelector("#load-leaving-member"),
  printSector: document.querySelector("#print-sector"),
  downloadSector: document.querySelector("#download-sector"),
  sectorSelects: document.querySelectorAll("[data-sector-select]"),
  numberInputs: document.querySelectorAll("[data-number-input]"),
};

document.addEventListener("DOMContentLoaded", async () => {
  await fetchSectors();
  renderStaticSectorOptions();
  setupNumberInputs();
  await migrateLocalStorageToDb();
  await refreshState();
  bindEvents();
  render();
  autoFillNewMemberNumber();

  setInterval(async () => {
    await refreshState();
    render();
  }, 60 * 60 * 1000);
});

async function migrateLocalStorageToDb() {
  const STORAGE_KEY = "church-family-registry-v1";
  const localData = localStorage.getItem(STORAGE_KEY);
  if (!localData) return;

  try {
    const parsed = JSON.parse(localData);
    if (!parsed || ((!parsed.members || parsed.members.length === 0) && (!parsed.leftMembers || parsed.leftMembers.length === 0))) return;

    console.log("Migrasi data dari localStorage ke database MySQL...");
    
    // Migrasi anggota aktif
    if (parsed.members && parsed.members.length > 0) {
      for (const member of parsed.members) {
        // Cek jika sudah ada di db biar gak duplikat
        const checkRes = await fetch(`${API_BASE_URL}/members`);
        const currentDbMembers = await checkRes.json();
        if (currentDbMembers.some(m => m.id === member.id)) continue;

        await fetch(`${API_BASE_URL}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(member)
        });
      }
    }

    // Migrasi anggota pindah/meninggal
    if (parsed.leftMembers && parsed.leftMembers.length > 0) {
      for (const member of parsed.leftMembers) {
        // Cek jika sudah ada
        const checkRes = await fetch(`${API_BASE_URL}/left-members`);
        const currentDbLeft = await checkRes.json();
        if (currentDbLeft.some(m => m.id === member.id)) continue;

        // Tambah sebagai aktif dulu
        const activeRecord = { ...member };
        delete activeRecord.leftId;
        delete activeRecord.reason;
        delete activeRecord.leftDate;
        delete activeRecord.notes;

        await fetch(`${API_BASE_URL}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(activeRecord)
        });

        // Mutasikan statusnya ke Pindah/Meninggal
        await fetch(`${API_BASE_URL}/members/${member.id}/leave`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: member.reason,
            leftDate: member.leftDate,
            notes: member.notes
          })
        });
      }
    }

    // Ganti nama key agar migrasi tidak berjalan ulang tetapi cadangan tetap aman
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(STORAGE_KEY + "-migrated-backup", localData);
    console.log("Migrasi data jemaat ke MySQL sukses!");
  } catch (error) {
    console.error("Gagal melakukan migrasi data:", error);
  }
}


async function fetchSectors() {
  try {
    const res = await fetch(`${API_BASE_URL}/sectors`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        SECTORS = data;
      }
    }
  } catch (error) {
    console.warn("Gagal mengambil daftar sektor dari server, menggunakan default:", error);
  }
}

async function refreshState() {
  try {
    const [membersRes, newMembersRes, leftMembersRes] = await Promise.all([
      fetch(`${API_BASE_URL}/members`),
      fetch(`${API_BASE_URL}/new-members`),
      fetch(`${API_BASE_URL}/left-members`)
    ]);

    if (!membersRes.ok || !newMembersRes.ok || !leftMembersRes.ok) {
      throw new Error("Server database belum siap. Pastikan server GKPI berjalan.");
    }

    state.members = await membersRes.json();
    state.newMembers = await newMembersRes.json();
    state.leftMembers = await leftMembersRes.json();
    state.syncError = "";
  } catch (error) {
    console.error("Gagal sinkronisasi data dari API backend:", error);
    state.syncError = "Data belum bisa dibaca dari server. Pastikan server GKPI aktif, lalu muat ulang halaman.";
  }
}

function bindEvents() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      els.tabs.forEach((item) => item.classList.remove("active"));
      els.panels.forEach((panel) => panel.classList.remove("active"));
      tab.classList.add("active");
      document.querySelector(`#${tab.dataset.tab}`).classList.add("active");
    });
  });

      // Helper: kumpulkan data formulir dan bersihkan nilai
      function prepareRecord(form) {
        const raw = formToRecord(form);
        return {
          id: createId(),
          number: raw.number,
          name: raw.name,
          status: raw.status || null,
          gender: raw.gender,
          address: raw.address || null,
          sector: raw.sector,
          birthDate: raw.birthDate || null,
          baptismDate: raw.baptismDate || null,
          confirmationDate: raw.confirmationDate || null,
          marriageDate: raw.marriageDate || null,
          familyId: familyIdFromNumber(raw.number),
          enteredAt: new Date().toISOString()
        };
      }

  els.newMemberForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    normalizeNumberInput(form.elements.number);
    const record = prepareRecord(form);

    console.log('Submitting new member record:', record); // debug

    try {
      const response = await fetch(`${API_BASE_URL}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record)
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('Server response error:', response.status, errText);
        throw new Error("Gagal menyimpan data jemaat baru ke server");
      }

      await refreshState();
      render();
      alert("Data anggota jemaat baru berhasil tersimpan.");
      autoFillNewMemberNumber();
    } catch (error) {
      alert(error.message);
    }
  });

  els.familyMemberForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    normalizeNumberInput(form.elements.number);
    
    const record = prepareRecord(form);

    try {
      const response = await fetch(`${API_BASE_URL}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record)
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('Server error:', response.status, errText);
        throw new Error("Gagal menyimpan data jemaat baru ke server");
      }

      await refreshState();
      render();
      form.reset();
      autoFillNewMemberNumber();
      alert("Data anggota keluarga berhasil tersimpan.");
    } catch (error) {
      alert(error.message);
    }
  });

  els.leavingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const memberId = formData.get("memberId");
    const member = state.members.find((item) => item.id === memberId);
    if (!member) return;

      const payload = {
        reason: formData.get("reason"),
        leftDate: formData.get("date"),
        notes: formData.get("notes")
      };

    try {
      const response = await fetch(`${API_BASE_URL}/members/${memberId}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error("Gagal memutasikan data jemaat");

      await refreshState();
      render();
      form.reset();
      alert(`Data jemaat ${String(payload.reason || "").toLowerCase()} berhasil tersimpan.`);
    } catch (error) {
      alert(error.message);
    }
  });

  els.sectorFilter.addEventListener("change", render);
  [els.movedDateFrom, els.movedDateTo, els.deceasedDateFrom, els.deceasedDateTo].forEach((filter) => {
    filter.addEventListener("input", renderLeftMembers);
    filter.addEventListener("change", renderLeftMembers);
  });
  [els.newMemberDateFrom, els.newMemberDateTo].forEach((filter) => {
    filter.addEventListener("input", renderNewMembers);
    filter.addEventListener("change", renderNewMembers);
  });
  els.dashboardYear.addEventListener("change", renderDashboard);
  els.existingFamily.addEventListener("change", fillSelectedFamilyDetails);
  els.leavingMember.addEventListener("change", renderSelectedLeavingMember);
  els.loadLeavingMember.addEventListener("click", renderSelectedLeavingMember);
  els.memberTable.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-member]");
    if (editButton) {
      openEditForm(editButton.dataset.editMember);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-member]");
    if (deleteButton) {
      deleteMember(deleteButton.dataset.deleteMember);
    }
  });
  els.editCancel.addEventListener("click", () => els.editDialog.close());
  els.editMemberForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveEditedMember(event.currentTarget);
  });
  els.processNewMembers.addEventListener("click", async () => {
    const confirmed = confirm("Bersihkan semua data dari Riwayat Anggota Baru? Data jemaat tetap tersimpan di Database Jemaat.");
    if (!confirmed) return;

    try {
      const response = await fetch(`${API_BASE_URL}/cleanup-new-history`, { method: "POST" });
      if (!response.ok) throw new Error("Gagal membersihkan riwayat anggota baru");
      await refreshState();
      render();
      alert("Riwayat anggota baru berhasil dibersihkan.");
    } catch (error) {
      console.error(error);
      alert(error.message);
    }
  });
  els.printSector.addEventListener("click", () => {
    setActiveTab("congregation");
    window.print();
  });
  els.downloadSector.addEventListener("click", downloadSectorExcel);
}

function formToRecord(form) {
  const formData = new FormData(form);
  return Object.fromEntries(fields.map((field) => [field, String(formData.get(field) || "").trim()]));
}

function renderStaticSectorOptions() {
  els.sectorSelects.forEach((select) => {
    select.innerHTML = [
      `<option value="">Pilih sektor</option>`,
      ...SECTORS.map((sector) => `<option value="${escapeHtml(sector)}">${escapeHtml(sector)}</option>`),
    ].join("");
  });
}

function setupNumberInputs() {
  els.numberInputs.forEach((input) => {
    if (!input.value) input.value = MEMBER_NUMBER_PREFIX;
    input.addEventListener("focus", () => normalizeNumberInput(input));
    input.addEventListener("input", () => normalizeNumberInput(input));
    input.addEventListener("blur", () => normalizeNumberInput(input));
  });
}

function resetNumberInputs(form) {
  form.querySelectorAll("[data-number-input]").forEach((input) => {
    input.value = MEMBER_NUMBER_PREFIX;
  });
}

function normalizeNumberInput(input) {
  if (!input) return;
  const raw = String(input.value || "").trim();
  if (!raw) {
    input.value = MEMBER_NUMBER_PREFIX;
    return;
  }

  const normalizedPrefix = MEMBER_NUMBER_PREFIX.toUpperCase();
  const upperRaw = raw.toUpperCase();
  if (upperRaw.startsWith(normalizedPrefix)) {
    input.value = MEMBER_NUMBER_PREFIX + raw.slice(MEMBER_NUMBER_PREFIX.length);
    return;
  }

  input.value = `${MEMBER_NUMBER_PREFIX}${raw}`;
}

function render() {
  renderSectorFilter();
  renderNewMembers();
  renderMembers();
  renderLeftMembers();
  renderFamilyOptions();
  renderMemberOptions();
  renderDashboard();
}

function renderSectorFilter() {
  const current = els.sectorFilter.value || "all";
  els.sectorFilter.innerHTML = [
    `<option value="all">Semua sektor</option>`,
    ...SECTORS.map((sector) => `<option value="${escapeHtml(sector)}">${escapeHtml(sector)}</option>`),
  ].join("");
  els.sectorFilter.value = SECTORS.includes(current) ? current : "all";
}

function renderNewMembers() {
  const dateFrom = els.newMemberDateFrom.value;
  const dateTo = els.newMemberDateTo.value;
  const filteredNewMembers = state.newMembers.filter((member) => {
    const date = String(member.enteredAt).slice(0, 10);
    return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
  });
  const rows = sortByFamilyNumber(filteredNewMembers).map((member) => {
    const entered = formatDate(member.enteredAt);
    const transferDate = formatDate(new Date(new Date(member.enteredAt).getTime() + 30 * MS_PER_DAY));
    return `
      <tr>
        <td>${escapeHtml(member.number)}</td>
        <td>${escapeHtml(member.name)}</td>
        <td>${escapeHtml(member.status)}</td>
        <td>${escapeHtml(displayGender(member.gender))}</td>
        <td>${escapeHtml(member.sector)}</td>
        <td>${formatDate(member.birthDate)}</td>
        <td>${entered}</td>
        <td>${transferDate}</td>
      </tr>`;
  });
  els.newMemberTable.innerHTML = rows.join("") || emptyRow(8);
}

function renderMembers() {
  const members = filteredMembers();
  els.activeSectorLabel.textContent = sectorLabel();
  els.sectorSummary.textContent = `${members.length} data jemaat aktif di ${sectorLabel().toLowerCase()}.`;
  els.memberTable.innerHTML =
    sortByFamilyNumber(members)
      .map(
        (member, index) => `
      <tr>
        <td class="print-only">${index + 1}</td>
        <td>${escapeHtml(member.number)}</td>
        <td>${escapeHtml(member.name)}</td>
        <td>${escapeHtml(member.status)}</td>
        <td class="gender-col">${escapeHtml(displayGender(member.gender))}</td>
        <td>${escapeHtml(member.address)}</td>
        <td>${escapeHtml(member.sector)}</td>
        <td>${formatDate(member.birthDate)}</td>
        <td>${formatDate(member.baptismDate)}</td>
        <td>${formatDate(member.confirmationDate)}</td>
        <td>${formatDate(member.marriageDate)}</td>
        <td class="actions-cell">
          <button class="icon-action" type="button" data-edit-member="${escapeHtml(member.id)}" title="Edit data" aria-label="Edit data ${escapeHtml(member.name)}">&#9998;</button>
          <button class="icon-action danger" type="button" data-delete-member="${escapeHtml(member.id)}" title="Hapus data" aria-label="Hapus data ${escapeHtml(member.name)}">&times;</button>
        </td>
      </tr>`,
      )
      .join("") || emptyRow(11);
}

function renderLeftMembers() {
  const movedDateFrom = els.movedDateFrom.value;
  const movedDateTo = els.movedDateTo.value;
  const deceasedDateFrom = els.deceasedDateFrom.value;
  const deceasedDateTo = els.deceasedDateTo.value;
  const deceased = state.leftMembers.filter(
    (member) => {
      const date = String(member.leftDate).slice(0, 10);
      return isDeceasedReason(member.reason) &&
        (!deceasedDateFrom || date >= deceasedDateFrom) &&
        (!deceasedDateTo || date <= deceasedDateTo);
    },
  );
  const moved = state.leftMembers.filter(
    (member) => {
      const date = String(member.leftDate).slice(0, 10);
      return !isDeceasedReason(member.reason) &&
        (!movedDateFrom || date >= movedDateFrom) &&
        (!movedDateTo || date <= movedDateTo);
    },
  );

  els.movedTable.innerHTML =
    moved
      .map(
        (member) => `
      <tr>
        <td>${escapeHtml(member.number)}</td>
        <td>${escapeHtml(member.name)}</td>
        <td>${escapeHtml(member.sector)}</td>
        <td>${formatDate(member.leftDate)}</td>
        <td>${escapeHtml(member.notes)}</td>
      </tr>`,
      )
      .join("") || emptyRow(5);

  els.deceasedTable.innerHTML =
    deceased
      .map(
        (member) => `
      <tr>
        <td>${escapeHtml(member.number)}</td>
        <td>${escapeHtml(member.name)}</td>
        <td>${escapeHtml(member.sector)}</td>
        <td>${formatDate(member.leftDate)}</td>
        <td>${escapeHtml(member.notes)}</td>
      </tr>`,
      )
      .join("") || emptyRow(5);
}

function renderFamilyOptions() {
  const families = new Map();
  state.members.filter(isHeadOfFamily).forEach((member) => {
    if (!families.has(member.familyId)) {
      families.set(member.familyId, `No. ${member.number} - ${member.name} - ${member.sector}`);
    }
  });

  els.existingFamily.innerHTML =
    [...families.entries()]
      .map(([familyId, label]) => `<option value="${escapeHtml(familyId)}">${escapeHtml(label)}</option>`)
      .join("") || `<option value="">Belum ada keluarga terdaftar</option>`;
  fillSelectedFamilyDetails();
}

function renderMemberOptions() {
  els.leavingMember.innerHTML =
    state.members
      .map((member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.name)} - ${escapeHtml(member.sector)}</option>`)
      .join("") || `<option value="">Belum ada anggota jemaat</option>`;
  renderSelectedLeavingMember();
}

function renderDashboard() {
  const currentYear = String(new Date().getFullYear());
  const selectedYear = els.dashboardYear.value || currentYear;
  const years = new Set([currentYear]);

  state.newMembers.forEach((member) => addYearFromDate(years, member.enteredAt));
  state.leftMembers.forEach((member) => addYearFromDate(years, member.leftDate));
  els.dashboardYear.innerHTML = [...years]
    .sort((a, b) => Number(b) - Number(a))
    .map((year) => `<option value="${year}">${year}</option>`)
    .join("");
  els.dashboardYear.value = years.has(selectedYear) ? selectedYear : currentYear;

  const male = state.members.filter((member) => isMale(member.gender)).length;
  const female = state.members.filter((member) => !isMale(member.gender)).length;
  renderPieChart(els.memberChart, els.memberChartLegend, [
    { label: "Jemaat/KK", value: countFamilies(state.members), color: "#2563eb" },
    { label: "Jumlah Jemaat", value: state.members.length, color: "#14b8a6" },
    { label: "Laki-laki", value: male, color: "#f59e0b" },
    { label: "Perempuan", value: female, color: "#ec4899" },
  ], "Komposisi jemaat");

  const year = els.dashboardYear.value;
  const newMembers = state.newMembers.filter((member) => dateYear(member.enteredAt) === year).length;
  const moved = state.leftMembers.filter(
    (member) => dateYear(member.leftDate) === year && !isDeceasedReason(member.reason),
  ).length;
  const deceased = state.leftMembers.filter(
    (member) => dateYear(member.leftDate) === year && isDeceasedReason(member.reason),
  ).length;
  els.dashboardYearLabel.textContent = `Tahun ${year}`;
  renderPieChart(els.yearChart, els.yearChartLegend, [
    { label: "Jemaat baru", value: newMembers, color: "#2563eb" },
    { label: "Pindah", value: moved, color: "#f59e0b" },
    { label: "Meninggal", value: deceased, color: "#ef4444" },
  ], `Perubahan jemaat tahun ${year}`);
}

function renderPieChart(chart, legend, items, label) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;
  const segments = total
    ? items.map((item) => {
        const start = cursor;
        cursor += (item.value / total) * 360;
        return `${item.color} ${start}deg ${cursor}deg`;
      })
    : ["#e6edf5 0deg 360deg"];
  chart.style.background = `conic-gradient(${segments.join(", ")})`;
  chart.setAttribute("aria-label", `${label}: ${items.map((item) => `${item.label} ${item.value}`).join(", ")}`);
  legend.innerHTML = items
    .map(
      (item) => `<div class="chart-legend-item">
        <span class="legend-dot" style="--legend-color: ${item.color}"></span>
        <span>${item.label}</span><strong>${item.value}</strong>
      </div>`,
    )
    .join("");
}

function addYearFromDate(years, value) {
  const year = dateYear(value);
  if (year) years.add(year);
}

function dateYear(value) {
  const match = String(value || "").match(/^(\d{4})/);
  return match ? match[1] : "";
}

function isMale(value) {
  const gender = String(value || "").toLowerCase();
  return gender.includes("laki") || gender === "male" || gender === "m";
}

function filteredMembers() {
  const sector = els.sectorFilter.value;
  return sector && sector !== "all" ? state.members.filter((member) => member.sector === sector) : state.members;
}

function sortByFamilyNumber(records) {
  return [...records].sort((a, b) => {
    const numberCompare = String(a.number || "").localeCompare(String(b.number || ""), undefined, { numeric: true });
    if (numberCompare !== 0) return numberCompare;
    const statusCompare = statusRank(a.status) - statusRank(b.status);
    if (statusCompare !== 0) return statusCompare;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function countFamilies(records) {
  return new Set(records.map((member) => normalizeText(member.number)).filter(Boolean)).size;
}

function statusRank(status) {
  const value = normalizeText(status);
  if (value.includes("kepala")) return 1;
  if (value.includes("istri")) return 2;
  if (value.includes("anak")) return 3;
  if (value.includes("family lain")) return 4;
  return 9;
}

function isHeadOfFamily(member) {
  return normalizeText(member.status).includes("kepala");
}

function sectorLabel() {
  const sector = els.sectorFilter.value;
  return sector && sector !== "all" ? `Sektor ${sector}` : "Semua sektor";
}

async function downloadSectorExcel() {
  try {
    const confirmed = confirm("Data jemaat akan diunduh dalam format Excel (.xlsx). Lanjutkan?");
    if (!confirmed) return;

    const sector = els.sectorFilter.value;
    const params = new URLSearchParams();
    if (sector && sector !== "all") {
      params.set("sector", sector);
    }

    const response = await fetch(`${API_BASE_URL}/download-members-xlsx${params.toString() ? `?${params.toString()}` : ""}`);
    if (!response.ok) {
      throw new Error("Gagal menyiapkan file Excel dari server.");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sectorLabel().replaceAll(" ", "-").toLowerCase()}-data-keluarga-jemaat.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message || "Gagal mengunduh file Excel.");
  }
}

function setActiveTab(tabId) {
  document.querySelector(`[data-tab="${tabId}"]`).click();
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function fillSelectedFamilyDetails() {
  const selectedFamilyId = els.existingFamily.value;
  const family = state.members.find((member) => member.familyId === selectedFamilyId);
  if (!family) return;

  els.familyMemberForm.elements.number.value = family.number || "";
  els.familyMemberForm.elements.address.value = family.address || "";
  els.familyMemberForm.elements.sector.value = family.sector || "";
}

function renderSelectedLeavingMember() {
  const member = state.members.find((item) => item.id === els.leavingMember.value);
  if (!member) {
    els.selectedMemberCard.textContent = "Belum ada data jemaat yang dipilih.";
    return;
  }

  els.selectedMemberCard.innerHTML = `
    <strong>${escapeHtml(member.name)}</strong><br>
    No. Jemaat: ${escapeHtml(member.number)}<br>
    Sektor: ${escapeHtml(member.sector)}<br>
    Alamat: ${escapeHtml(member.address)}
  `;
}

function openEditForm(memberId) {
  const member = state.members.find((item) => item.id === memberId);
  if (!member) return;

  fields.forEach((field) => {
    els.editMemberForm.elements[field].value = member[field] || "";
  });
  normalizeNumberInput(els.editMemberForm.elements.number);
  els.editMemberForm.elements.id.value = member.id;
  els.editDialog.showModal();
}

async function saveEditedMember(form) {
  const id = form.elements.id.value;
  normalizeNumberInput(form.elements.number);
  const updates = formToRecord(form);
  updates.id = id;
  updates.familyId = familyIdFromNumber(updates.number);

  try {
    const response = await fetch(`${API_BASE_URL}/members/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates)
    });

    if (!response.ok) throw new Error("Gagal menyimpan perubahan ke server");

    await refreshState();
    render();
    els.editDialog.close();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteMember(memberId) {
  const member = state.members.find((item) => item.id === memberId);
  if (!member) return;

  const confirmed = confirm(`Hapus data jemaat ${member.name} dari Database Jemaat?`);
  if (!confirmed) return;

  try {
    const response = await fetch(`${API_BASE_URL}/members/${memberId}`, {
      method: "DELETE"
    });

    if (!response.ok) throw new Error("Gagal menghapus data jemaat dari server");

    await refreshState();
    render();
  } catch (error) {
    alert(error.message);
  }
}

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function familyIdFromNumber(number) {
  return `jemaat-${String(number || "").trim().toUpperCase()}`;
}

function emptyRow(colspan) {
  return `<tr><td colspan="${colspan}" class="empty">${escapeHtml(state.syncError || "Belum ada data.")}</td></tr>`;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return date.toLocaleDateString("id-ID", { year: "numeric", month: "short", day: "2-digit" });
}

function displayGender(value) {
  if (value === "Female") return "Perempuan";
  if (value === "Male") return "Laki-laki";
  return value;
}

function isDeceasedReason(reason) {
  return String(reason || "").toLowerCase().includes("meninggal");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function generateNextMemberNumber() {
  const prefix = "GKPI-PKU-KOTA";
  let maxNum = 0;

  const allNumbers = [
    ...state.members.map((m) => m.number),
    ...state.leftMembers.map((m) => m.number),
    ...state.newMembers.map((m) => m.number)
  ];

  for (const num of allNumbers) {
    if (num && num.startsWith(prefix)) {
      const digitPart = num.slice(prefix.length);
      const val = parseInt(digitPart, 10);
      if (!isNaN(val) && val > maxNum) {
        maxNum = val;
      }
    }
  }

  const nextNum = maxNum + 1;
  const padded = String(nextNum).padStart(5, "0");
  return `${prefix}${padded}`;
}

function autoFillNewMemberNumber() {
  const nextNumber = generateNextMemberNumber();
  const input = els.newMemberForm.elements.number;
  if (input) {
    input.value = nextNumber;
  }
}
