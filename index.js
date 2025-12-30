// index.js
import { validateAndNormalize } from "./compiler/parser.js";
import { generateModelFiles } from "./compiler/codegen.js";

const fileInput = document.getElementById("fileInput");
const translateButton = document.getElementById("translateButton");
const copyButton = document.getElementById("copyButton");
const downloadButton = document.getElementById("downloadButton");
const themeToggle = document.getElementById("themeToggle");
const formatJsonBtn = document.getElementById("formatJsonBtn");

// ZOOM BUTTONS
const jsonZoomIn = document.getElementById("jsonZoomIn");
const jsonZoomOut = document.getElementById("jsonZoomOut");
const pyZoomIn = document.getElementById("pyZoomIn");
const pyZoomOut = document.getElementById("pyZoomOut");

let lastFiles = null;
let currentTheme = "dark";

// --- Helper Functions ---
function getJsonContent() {
  if (window.jsonEditor) return window.jsonEditor.getValue();
  return "";
}

function setJsonContent(text) {
  if (window.jsonEditor) window.jsonEditor.setValue(text);
}

function setPythonContent(text) {
  if (window.pythonEditor) window.pythonEditor.setValue(text);
}

function combineFilesOrdered(files) {
  const orderPriority = ["runtime/base.py", "runtime/state_machine.py", "runtime/storage.py", "runtime/relationship.py", "app.py"];

  const runtimeFiles = [];
  const modelFiles = [];
  const appFile = [];

  Object.entries(files).forEach(([fname, content]) => {
    let cleanContent = content
      .replace(/from runtime\..+ import .+/g, "")
      .replace(/from models\..+ import .+/g, "")
      .trim();

    const sectionHeader = `\n# ${"=".repeat(50)}\n# FILE: ${fname}\n# ${"=".repeat(50)}\n`;
    const fullBlock = sectionHeader + cleanContent + "\n";

    if (fname === "app.py") {
      appFile.push(fullBlock);
    } else if (fname.startsWith("runtime/")) {
      const index = orderPriority.indexOf(fname);
      runtimeFiles[index !== -1 ? index : 99] = fullBlock;
    } else {
      modelFiles.push(fullBlock);
    }
  });

  return [...runtimeFiles.filter(Boolean), ...modelFiles, ...appFile].join("\n");
}

// --- Event Listeners ---

// 1. ZOOM LOGIC
jsonZoomIn.addEventListener("click", () => {
  if (window.jsonEditor) window.jsonEditor.getAction("editor.action.fontZoomIn").run();
});
jsonZoomOut.addEventListener("click", () => {
  if (window.jsonEditor) window.jsonEditor.getAction("editor.action.fontZoomOut").run();
});
pyZoomIn.addEventListener("click", () => {
  if (window.pythonEditor) window.pythonEditor.getAction("editor.action.fontZoomIn").run();
});
pyZoomOut.addEventListener("click", () => {
  if (window.pythonEditor) window.pythonEditor.getAction("editor.action.fontZoomOut").run();
});

// 2. FILE HANDLING
fileInput.addEventListener("change", (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    setJsonContent(e.target.result);
    setTimeout(() => {
      if (window.jsonEditor) window.jsonEditor.getAction("editor.action.formatDocument").run();
    }, 500);
  };
  reader.readAsText(f);
});

formatJsonBtn.addEventListener("click", () => {
  if (window.jsonEditor) window.jsonEditor.getAction("editor.action.formatDocument").run();
});

translateButton.addEventListener("click", () => {
  try {
    const raw = getJsonContent().trim();
    if (!raw) return alert("Please enter xtUML JSON model.");

    const jsonObj = JSON.parse(raw);
    const model = validateAndNormalize(jsonObj);
    const files = generateModelFiles(model);

    lastFiles = files;

    const combinedPreview = combineFilesOrdered(files);
    setPythonContent(combinedPreview);
  } catch (err) {
    let errorMsg = "# ERROR DURING COMPILATION:\n";
    if (err.errors && Array.isArray(err.errors)) {
      errorMsg += err.errors.map((e, idx) => `${idx + 1}. [${e.path}] ${e.message}${e.hint ? ` (hint: ${e.hint})` : ""}`).join("\n");
    } else {
      errorMsg += `# ${err.message}\n\n# Check your JSON input structure.`;
    }
    setPythonContent(errorMsg);
    alert("Compilation Failed: " + err.message);
    console.error(err);
  }
});

themeToggle.addEventListener("click", () => {
  if (currentTheme === "dark") {
    document.body.setAttribute("data-theme", "light");
    themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
    if (window.monaco) window.monaco.editor.setTheme("vs");
    currentTheme = "light";
  } else {
    document.body.removeAttribute("data-theme");
    themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
    if (window.monaco) window.monaco.editor.setTheme("vs-dark");
    currentTheme = "dark";
  }
});

copyButton.addEventListener("click", () => {
  const code = window.pythonEditor ? window.pythonEditor.getValue() : "";
  if (!code) return;
  navigator.clipboard.writeText(code).then(() => {
    const originalIcon = copyButton.innerHTML;
    copyButton.innerHTML = '<i class="fas fa-check"></i>';
    setTimeout(() => (copyButton.innerHTML = originalIcon), 1500);
  });
});

downloadButton.addEventListener("click", async () => {
  if (!lastFiles) return alert("Compile code first.");
  if (!window.JSZip) return alert("JSZip library failed to load.");

  const zip = new window.JSZip();
  for (const [fname, content] of Object.entries(lastFiles)) {
    zip.file(fname, content);
  }

  let modelName = "xtuml_build";
  try {
    const j = JSON.parse(getJsonContent());
    if (j.sub_name) modelName = j.sub_name;
  } catch (e) {}

  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${modelName}.zip`;
  a.click();
});
