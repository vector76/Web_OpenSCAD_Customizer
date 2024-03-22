import { spawnOpenSCAD } from "./openscad-runner.js";
import { buildFeatureCheckboxes } from "./features.js";

const runButton = document.getElementById("run");
const killButton = document.getElementById("kill");
const metaElement = document.getElementById("meta");
const linkContainerElement = document.getElementById("link-container");
const autorotateCheckbox = document.getElementById("autorotate");
const stlViewerElement = document.getElementById("viewer");
const logsElement = document.getElementById("logs");
const featuresContainer = document.getElementById("features");
const flipModeButton = document.getElementById("flip-mode");

const queryParams = new URLSearchParams(location.search);

function getFormProp(prop) {
  const propType = model_params[prop].type;
  const propElt = document.getElementById("param_" + prop);
  if (propType === "checkbox") {
    return propElt.checked;
  }
  if (propType === "number") {
    return Number(propElt.value);
  }
  return String(propElt.value);
}

function paramChanged() {
  const query_parts = [];
  for (const prop in model_params) {
    query_parts.push(prop + "=" + getFormProp(prop));
  }

  // update permalink
  const permalink = document.getElementById("permalink"); // should be <a href...
  permalink.href = "?" + query_parts.join("&");
}

function generateParamForm() {
  // Add DOM elements based on the model_params
  const paramsDiv = document.getElementById("params");
  for (const param in model_params) {
    const text = document.createElement("div");
    text.id = "param_div_" + param;

    const description = model_params[param].description;
    if (description) {
      text.innerHTML += description + "</br>";
    }

    const defaultValue = model_params[param].defaultValue;
    const paramType = model_params[param].type;
    const qstr = queryParams.get(param); // always string or undefined

    text.innerHTML += `<code>${param}</code>: `;
    let inputRaw;
    if (paramType === "checkbox") {
      const checked = (typeof qstr === "string")
        ? qstr.toLowerCase() === "true"
        : defaultValue;
      inputRaw =
        `<input type="checkbox" checked="${checked}" id="param_${param}" />`;
    } else if (paramType === "number") {
      const anyValue = (typeof qstr === "string") ? Number(qstr) : defaultValue;
      // check for nan by testing if value equals itself
      const value = anyValue == anyValue ? anyValue : defaultValue;
      inputRaw = `<input type="number" value="${value}" id="param_${param}" />`;
    } else if (paramType === "select") {
      const selectedOption = (typeof qstr === "string") ? qstr : defaultValue;
      console.log("selectedOption", selectedOption);
      const options = model_params[param].options ?? [];
      inputRaw = `
      <select id="param_${param}">
      ${
        options.map((option) =>
          `<option value="${option}" ${
            selectedOption === option ? "selected" : ""
          }>${option}</option>`
        )
      }
      </select>
      `;
    } else {
      const value = (typeof qstr === "string") ? qstr : defaultValue;
      inputRaw = `<input type="text" value="${value}" id="param_${param}" />`;
    }
    text.innerHTML += inputRaw;
    text.innerHTML += "</br></br>";
    paramsDiv.appendChild(text);
    const newinp = document.getElementById("param_" + param);
    newinp.onchange = paramChanged;
  }
}

generateParamForm();
paramChanged();

const featureCheckboxes = {};

const persistCameraState = false;
let stlViewer;
let stlFile;

function buildStlViewer() {
  const stlViewer = new StlViewer(stlViewerElement);
  stlViewer.model_loaded_callback = (id) => {
    stlViewer.set_color(id, "#f9d72c");
    stlViewer.set_auto_zoom(true);
    stlViewer.set_auto_resize(true);
  };
  return stlViewer;
}

function viewStlFile() {
  try {
    stlViewer.remove_model(1);
  } catch (_e) {
    //
  }
  stlViewer.add_model({ id: 1, local_file: stlFile, rotationx: -1.5708 });
}

function addDownloadLink(container, blob, fileName) {
  const link = document.createElement("a");
  link.innerText = fileName;
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  container.append(link);
  return link;
}

function formatMillis(n) {
  if (n < 1000) {
    return `${Math.floor(n / 1000)} sec`;
  }
  return `${Math.floor(n / 100) / 10} sec`;
}

let lastJob;

killButton.onclick = () => {
  if (lastJob) {
    lastJob.kill();
    lastJob = null;
  }
};

function setAutoRotate(value) {
  autorotateCheckbox.checked = value;
  stlViewer.set_auto_rotate(value);
}

function setViewerFocused(value) {
  if (value) {
    flipModeButton.innerText = "Edit";
    stlViewerElement.classList.add("focused");
  } else {
    flipModeButton.innerText = "Interact ?";
    stlViewerElement.classList.remove("focused");
  }
}
function isViewerFocused() {
  return stlViewerElement.classList.contains("focused");
}

function setExecuting(v) {
  killButton.disabled = !v;
}

let lastProcessedOutputsTimestamp;

function processMergedOutputs(mergedOutputs, timestamp) {
  if (
    lastProcessedOutputsTimestamp != null &&
    timestamp < lastProcessedOutputsTimestamp
  ) {
    // We have slow (render) and fast (syntax check) runs running concurrently.
    // The results of slow runs might be out of date now.
    return;
  }
  lastProcessedOutputsTimestamp = timestamp;

  const unmatchedLines = [];
  const allLines = [];

  let warningCount = 0, errorCount = 0;
  const addError = (error, file, line) => {
  };
  for (const { stderr, stdout, error } of mergedOutputs) {
    allLines.push(stderr ?? stdout ?? `EXCEPTION: ${error}`);
    if (stderr) {
      if (stderr.startsWith("ERROR:")) errorCount++;
      if (stderr.startsWith("WARNING:")) warningCount++;

      let m = /^ERROR: Parser error in file "([^"]+)", line (\d+): (.*)$/.exec(
        stderr,
      );
      if (m) {
        continue;
      }

      m = /^ERROR: Parser error: (.*?) in file ([^",]+), line (\d+)$/.exec(
        stderr,
      );
      if (m) {
        continue;
      }

      m = /^WARNING: (.*?),? in file ([^,]+), line (\d+)\.?/.exec(stderr);
      if (m) {
        continue;
      }
    }
    unmatchedLines.push(stderr ?? stdout ?? `EXCEPTION: ${error}`);
  }
  if (errorCount || warningCount) {
    unmatchedLines = [
      `${errorCount} errors, ${warningCount} warnings!`,
      "",
      ...unmatchedLines,
    ];
  }

  logsElement.innerText = allLines.join("\n");
}

let sourceFileName;

function turnIntoDelayableExecution(delay, createJob) {
  let pendingId;
  let runningJobKillSignal;

  const doExecute = async () => {
    if (runningJobKillSignal) {
      runningJobKillSignal();
      runningJobKillSignal = null;
    }
    const { kill, completion } = createJob();
    runningJobKillSignal = kill;
    try {
      await completion;
    } finally {
      runningJobKillSignal = null;
    }
  };
  return ({ now }) => {
    if (pendingId) {
      clearTimeout(pendingId);
      pendingId = null;
    }
    if (now) {
      doExecute();
    } else {
      pendingId = setTimeout(doExecute, delay);
    }
  };
}

const renderDelay = 1000;
const render = turnIntoDelayableExecution(renderDelay, () => {
  const source = "include <" + model_path + ">";
  const model_dir = model_path.split(/[\\/]/)[0];
  const timestamp = Date.now();
  metaElement.innerText = "rendering...";
  metaElement.title = null;
  runButton.disabled = true;
  setExecuting(true);

  const arglist = [
    "input.scad",
    "-o",
    outstl_name,
    ...Object.keys(featureCheckboxes).filter((f) =>
      featureCheckboxes[f].checked
    ).map((f) => `--enable=${f}`),
  ];

  // add model parameters
  for (const prop in model_params) {
    if (typeof model_params[prop].defaultValue === "string") {
      arglist.push("-D", prop + '="' + getFormProp(prop) + '"');
    } else {
      // number and boolean work with ordinary typecasting
      arglist.push("-D", prop + "=" + getFormProp(prop));
    }
  }

  // console.log(arglist);

  const job = spawnOpenSCAD({
    inputs: [["input.scad", source]],
    args: arglist,
    outputPaths: [outstl_name],
    zipArchives: [model_dir], // just a list of zip files (no longer an object)
  });

  return {
    kill: () => job.kill(),
    completion: (async () => {
      try {
        const result = await job;
        // console.log(result);
        processMergedOutputs(result.mergedOutputs, timestamp);

        if (result.error) {
          throw result.error;
        }

        metaElement.innerText = formatMillis(result.elapsedMillis);

        const [output] = result.outputs;
        if (!output) throw "No output from runner!";
        const [filePath, content] = output;
        const filePathFragments = filePath.split("/");
        const fileName = filePathFragments[filePathFragments.length - 1];

        // TODO: have the runner accept and return files.
        const blob = new Blob([content], { type: "application/octet-stream" });
        stlFile = new File([blob], fileName);

        viewStlFile(stlFile);

        linkContainerElement.innerHTML = "";
        addDownloadLink(linkContainerElement, blob, fileName);
      } catch (e) {
        console.error(e, e.stack);
        metaElement.innerText = "<failed>";
        metaElement.title = e.toString();
      } finally {
        setExecuting(false);
        runButton.disabled = false;
      }
    })(),
  };
});

runButton.onclick = () => render({ now: true });

function getState() {
  const features = Object.keys(featureCheckboxes).filter((f) =>
    featureCheckboxes[f].checked
  );
  return {
    source: {
      name: sourceFileName,
      content: "include <" + model_path + ">",
    },
    autorotate: autorotateCheckbox.checked,
    features,
    viewerFocused: isViewerFocused(),
    camera: persistCameraState ? stlViewer.get_camera_state() : null,
  };
}

function normalizeSource(src) {
  return src.replaceAll(/\/\*.*?\*\/|\/\/.*?$/gm, "")
    .replaceAll(/([,.({])\s+/gm, "$1")
    .replaceAll(/\s+([,.({])/gm, "$1")
    .replaceAll(/\s+/gm, " ")
    .trim();
}
function normalizeStateForCompilation(state) {
  return {
    ...state,
    source: {
      ...state.source,
      content: normalizeSource(state.source.content),
    },
  };
}

const defaultState = {
  source: {
    name: "input.stl",
    content: "include <" + model_path + ">",
  },
  maximumMegabytes: 1024,
  viewerFocused: false,
  features: [
    "fast-csg",
    "fast-csg-trust-corefinement",
    "fast-csg-remesh",
    "fast-csg-exact-callbacks",
    "lazy-union",
  ],
};

function setState(state) {
  sourceFileName = state.source.name || "input.scad";
  if (state.camera && persistCameraState) {
    stlViewer.set_camera_state(state.camera);
  }
  let features = new Set();
  if (state.features) {
    features = new Set(state.features);
    Object.keys(featureCheckboxes).forEach((f) =>
      featureCheckboxes[f].checked = features.has(f)
    );
  }
  setAutoRotate(state.autorotate ?? true);
  setViewerFocused(state.viewerFocused ?? false);
}

let previousNormalizedState;
function onStateChanged({ allowRun }) {
  const newState = getState();

  featuresContainer.style.display = "none";

  const normalizedState = normalizeStateForCompilation(newState);
  if (
    JSON.stringify(previousNormalizedState) != JSON.stringify(normalizedState)
  ) {
    previousNormalizedState = normalizedState;

    if (allowRun) {
      render({ now: false });
    }
  }
}

function pollCameraChanges() {
  if (!persistCameraState) {
    return;
  }
  let lastCam;
  setInterval(function () {
    const ser = JSON.stringify(stlViewer.get_camera_state());
    if (ser != lastCam) {
      lastCam = ser;
      onStateChanged({ allowRun: false });
    }
  }, 1000); // TODO only if active tab
}

try {
  stlViewer = buildStlViewer();
  stlViewerElement.ondblclick = () => {
    setAutoRotate(!autorotateCheckbox.checked);
    onStateChanged({ allowRun: false });
  };

  const initialState = defaultState;

  setState(initialState);
  await buildFeatureCheckboxes(featuresContainer, featureCheckboxes, () => {
    onStateChanged({ allowRun: true });
  });
  setState(initialState);

  autorotateCheckbox.onchange = () => {
    stlViewer.set_auto_rotate(autorotateCheckbox.checked);
    onStateChanged({ allowRun: false });
  };

  flipModeButton.onclick = () => {
    const wasViewerFocused = isViewerFocused();
    setViewerFocused(!wasViewerFocused);

    if (!wasViewerFocused) {
      setAutoRotate(false);
    }
    onStateChanged({ allowRun: false });
  };

  pollCameraChanges();
  onStateChanged({ allowRun: true });
} catch (e) {
  console.error(e);
}
