import { spawnOpenSCAD } from './openscad-runner.js'
import { buildFeatureCheckboxes } from './features.js';

const editorElement = document.getElementById('dummyEditor');
const runButton = document.getElementById('run');
const killButton = document.getElementById('kill');
const metaElement = document.getElementById('meta');
const linkContainerElement = document.getElementById('link-container');
const autorotateCheckbox = document.getElementById('autorotate');
const stlViewerElement = document.getElementById("viewer");
const logsElement = document.getElementById("logs");
const featuresContainer = document.getElementById("features");
const flipModeButton = document.getElementById("flip-mode");
const paramsForm = document.getElementById("params");

const queryParams = new URLSearchParams(location.search);


function getFormProp(prop) {
  const propType = typeof model_default_params[prop];
  const propElt = document.getElementById("param_" + prop);
  if (propType == "boolean") {
    return propElt.checked;
  }
  else if (propType === "number") {
    return Number(propElt.value);
  }
  else {
    // console.log("forcing element " + prop + " to string '" + String(propElt.value) + "'.");
    return String(propElt.value);  // force to string
  }
}


function paramChanged() {
  var query_parts = [];
  for (var prop in model_default_params) {
    query_parts.push(prop + "=" + getFormProp(prop));
  }
  
  // update permalink
  const permalink = document.getElementById("permalink");  // should be <a href...
  permalink.href = "?" + query_parts.join("&");
}


function generateParamForm() {
  // Add DOM elements based on the model_default_params
  const paramsDiv = document.getElementById("params");
  for (var prop in model_default_params) {
    const text = document.createElement('div');
    text.id = 'param_div_' + prop;
    
    if (typeof model_param_desriptions == 'object') {
      var helpstr = model_param_desriptions[prop];
      if (typeof helpstr == 'string') {
        text.innerHTML += helpstr + '</br>';
      }
    }
    
    const dval = model_default_params[prop];  // default value always defined
    const propType = typeof dval;
    const qstr = queryParams.get(prop);       // always string or undefined
    
    //console.log(prop + " is of type " + propType + " with query value '" + qstr + "' and default " + dval);
    
    if (propType == "boolean") {
      const val = (typeof qstr === 'string') ? qstr.toLowerCase() === 'true' : dval;
      if (val) {
        text.innerHTML += prop + ": <input type='checkbox' checked id='param_" + prop + "'/></br></br>";
      }
      else {
        text.innerHTML += prop + ": <input type='checkbox' id='param_" + prop + "'/></br></br>";
      }
    }
    else if (propType === "number") {
      const val1 = (typeof qstr === 'string') ? Number(qstr) : dval;
      // check for nan by testing if value equals itself
      const val = val1 == val1 ? val1 : dval;
      text.innerHTML += prop + ": <input type='number' value='" + val + "' id='param_" + prop + "'/></br></br>";
    }
    else {
      // anything else assuming string for now (no drop-downs implemented yet)
      const val = (typeof qstr === 'string') ? qstr : dval;
      text.innerHTML += prop + ": <input type='text' value='" + val + "' id='param_" + prop + "'/></br></br>";
    }
    paramsDiv.appendChild(text);
    const newinp = document.getElementById("param_" + prop);
    newinp.onchange = paramChanged;
  }
}

generateParamForm();
paramChanged();

paramsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  render({ now: true });
});


const featureCheckboxes = {};

var persistCameraState = false;
var stlViewer;
var stlFile;
var svgFile;

function buildStlViewer() {
  const stlViewer = new StlViewer(stlViewerElement);
  stlViewer.model_loaded_callback = id => {
    stlViewer.set_color(id, '#f9d72c');
    stlViewer.set_auto_zoom(true);
    stlViewer.set_auto_resize(true);
  };    
  return stlViewer;
}

function viewStlFile() {
  try { stlViewer.remove_model(1); } catch (e) {}
  stlViewer.add_model({ id: 1, local_file: stlFile, rotationx: -1.5708 });
}

function addDownloadLink(container, blob, fileName) {
  const link = document.createElement('a');
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
    flipModeButton.innerText = 'Edit';
    stlViewerElement.classList.add('focused');
  } else {
    flipModeButton.innerText = 'Interact ?';
    stlViewerElement.classList.remove('focused');
  }
}
function isViewerFocused() {
  return stlViewerElement.classList.contains('focused');
}

function setExecuting(v) {
  killButton.disabled = !v;
}

var lastProcessedOutputsTimestamp;

function processMergedOutputs(mergedOutputs, timestamp) {
  if (lastProcessedOutputsTimestamp != null && timestamp < lastProcessedOutputsTimestamp) {
    // We have slow (render) and fast (syntax check) runs running concurrently.
    // The results of slow runs might be out of date now.
    return;
  }
  lastProcessedOutputsTimestamp = timestamp;

  let unmatchedLines = [];
  let allLines = [];

  const markers = [];
  let warningCount = 0, errorCount = 0;
  const addError = (error, file, line) => {
  }
  for (const {stderr, stdout, error} of mergedOutputs){
    allLines.push(stderr ?? stdout ?? `EXCEPTION: ${error}`);
    if (stderr) {
      if (stderr.startsWith('ERROR:')) errorCount++;
      if (stderr.startsWith('WARNING:')) warningCount++;

      let m = /^ERROR: Parser error in file "([^"]+)", line (\d+): (.*)$/.exec(stderr)
      if (m) {
        continue;
      }

      m = /^ERROR: Parser error: (.*?) in file ([^",]+), line (\d+)$/.exec(stderr)
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
  if (errorCount || warningCount) unmatchedLines = [`${errorCount} errors, ${warningCount} warnings!`, '', ...unmatchedLines];

  logsElement.innerText = allLines.join("\n")
}

var sourceFileName;

function turnIntoDelayableExecution(delay, createJob) {
  var pendingId;
  var runningJobKillSignal;

  const doExecute = async () => {
    if (runningJobKillSignal) {
      runningJobKillSignal();
      runningJobKillSignal = null;
    }
    const {kill, completion} = createJob();
    runningJobKillSignal = kill;
    try {
      await completion;
    } finally {
      runningJobKillSignal = null;
    }
  }
  return async ({now}) => {
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

var renderDelay = 1000;
const render = turnIntoDelayableExecution(renderDelay, () => {
  const source = 'include <' + model_path + '>';
  const model_dir = model_path.split(/[\\/]/)[0];
  const timestamp = Date.now();
  metaElement.innerText = 'rendering...';
  metaElement.title = null;
  runButton.disabled = true;
  setExecuting(true);
  
  var arglist = [ 
    "input.scad",
    "-o", outstl_name,
    ...Object.keys(featureCheckboxes).filter(f => featureCheckboxes[f].checked).map(f => `--enable=${f}`),
    ];

  // add model parameters
  for (var prop in model_default_params) {
    if (typeof model_default_params[prop] == "string") {
      arglist.push("-D", prop + '="' + getFormProp(prop) + '"');
    }
    else {
      // number and boolean work with ordinary typecasting
      arglist.push("-D", prop + "=" + getFormProp(prop));
    }
  }
  
  // console.log(arglist);
  
  const job = spawnOpenSCAD({
    inputs: [['input.scad', source]],
    args: arglist,
    outputPaths: [outstl_name],
    zipArchives: [model_dir],  // just a list of zip files (no longer an object)
  });

  var only_3d = (typeof outsvg_name === 'undefined');

  if (!only_3d) {
    var arglist2 = [ 
      "input.scad",
      "-o", outsvg_name,
      ...Object.keys(featureCheckboxes).filter(f => featureCheckboxes[f].checked).map(f => `--enable=${f}`),
      ];
      
    for (var prop in model_default_params) {
      if (typeof model_default_params[prop] == "string") {
        arglist2.push("-D", prop + '="' + getFormProp(prop) + '"');
      }
      else {
        arglist2.push("-D", prop + "=" + getFormProp(prop));
      }
    }
    arglist2.push("-D", "render_2d=true");

    var job2 = spawnOpenSCAD({
      inputs: [['input.scad', source]],
      args: arglist2,
      outputPaths: [outsvg_name],
      zipArchives: [model_dir],  // just a list of zip files (no longer an object)
    });
  }

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
        if (!output) throw 'No output from runner!'
        const [filePath, content] = output;
        const filePathFragments = filePath.split('/');
        const fileName = filePathFragments[filePathFragments.length - 1];

        // TODO: have the runner accept and return files.
        const blob = new Blob([content], { type: "application/octet-stream" });
        stlFile = new File([blob], fileName);

        viewStlFile(stlFile);

        if (only_3d) {
          linkContainerElement.innerHTML = '';
          addDownloadLink(linkContainerElement, blob, fileName);
        }
        else {
          // result from SVG rendering is available for download
          const result2 = await job2;
          // console.log(result);
          processMergedOutputs(result2.mergedOutputs, timestamp);
    
          if (result2.error) {
            throw result2.error;
          }
          
          const [output2] = result2.outputs;
          if (!output2) throw 'No output from runner!'
          const [filePath2, content2] = output2;
          const filePathFragments2 = filePath2.split('/');
          const fileName2 = filePathFragments2[filePathFragments2.length - 1];

          const blob2 = new Blob([content2], { type: "application/octet-stream" });
          svgFile = new File([blob], fileName2);
          linkContainerElement.innerHTML = '';
          addDownloadLink(linkContainerElement, blob2, fileName2);
        }
      } catch (e) {
        console.error(e, e.stack);
        metaElement.innerText = '<failed>';
        metaElement.title = e.toString();
      } finally {
        setExecuting(false);
        runButton.disabled = false;
      }
    })()
  }
});

runButton.onclick = () => render({now: true});

function getState() {
  const features = Object.keys(featureCheckboxes).filter(f => featureCheckboxes[f].checked);
  return {
    source: {
      name: sourceFileName,
      content: 'include <' + model_path + '>',
    },
    autorotate: autorotateCheckbox.checked,
    features,
    viewerFocused: isViewerFocused(),
    camera: persistCameraState ? stlViewer.get_camera_state() : null,
  };
}

function normalizeSource(src) {
  return src.replaceAll(/\/\*.*?\*\/|\/\/.*?$/gm, '')
    .replaceAll(/([,.({])\s+/gm, '$1')
    .replaceAll(/\s+([,.({])/gm, '$1')
    .replaceAll(/\s+/gm, ' ')
    .trim()
}
function normalizeStateForCompilation(state) {
  return {
    ...state,
    source: {
      ...state.source,
      content: normalizeSource(state.source.content)
    },
  }
}

const defaultState = {
  source: {
    name: 'input.stl',
    content: 'include <' + model_path + '>',
  },
  maximumMegabytes: 1024,
  viewerFocused: false,
  features: ['fast-csg', 'fast-csg-trust-corefinement', 'fast-csg-remesh', 'fast-csg-exact-callbacks', 'lazy-union'],
};

function setState(state) {
  sourceFileName = state.source.name || 'input.scad';
  if (state.camera && persistCameraState) {
    stlViewer.set_camera_state(state.camera);
  }
  let features = new Set();
  if (state.features) {
    features = new Set(state.features);
    Object.keys(featureCheckboxes).forEach(f => featureCheckboxes[f].checked = features.has(f));
  }
  setAutoRotate(state.autorotate ?? true)
  setViewerFocused(state.viewerFocused ?? false);
}

var previousNormalizedState;
function onStateChanged({allowRun}) {
  const newState = getState();

  featuresContainer.style.display = 'none';

  const normalizedState = normalizeStateForCompilation(newState);
  if (JSON.stringify(previousNormalizedState) != JSON.stringify(normalizedState)) {
    previousNormalizedState = normalizedState;
    
    if (allowRun) {
      render({now: false});
    }
  }
}

function pollCameraChanges() {
  if (!persistCameraState) {
    return;
  }
  let lastCam;
  setInterval(function() {
    const ser = JSON.stringify(stlViewer.get_camera_state());
    if (ser != lastCam) {
      lastCam = ser;
      onStateChanged({allowRun: false});
    }
  }, 1000); // TODO only if active tab
}

try {
  stlViewer = buildStlViewer();
  stlViewerElement.ondblclick = () => {
    setAutoRotate(!autorotateCheckbox.checked);
    onStateChanged({allowRun: false});
  };

  const initialState = defaultState;
  
  setState(initialState);
  await buildFeatureCheckboxes(featuresContainer, featureCheckboxes, () => {  
    onStateChanged({allowRun: true});
  });
  setState(initialState);
  
  autorotateCheckbox.onchange = () => {
    stlViewer.set_auto_rotate(autorotateCheckbox.checked);
    onStateChanged({allowRun: false});
  };

  flipModeButton.onclick = () => {
    const wasViewerFocused = isViewerFocused();
    setViewerFocused(!wasViewerFocused);

    if (!wasViewerFocused) {
      setAutoRotate(false);
    }
    onStateChanged({allowRun: false});
  };
  
  pollCameraChanges();
  onStateChanged({allowRun: true});
} catch (e) {
  console.error(e);
}
