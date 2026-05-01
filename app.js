const STATE = {
  store: null,
  fullStore: null,
  crashStore: null,
  playing: false,
  speed: 1,
  currentTime: 0,
  currentIndex: 0,
  lastTick: null,
  charts: {},
  ranges: {},
};

const META = {
  keySegment: null,
};

const FIELD_META = {
  airspeed: { label: '空速', unit: 'kt', digits: 1 },
  altitude: { label: '气压高度', unit: 'ft', digits: 0 },
  pitch: { label: '俯仰角', unit: '°', digits: 1 },
  roll: { label: '滚转角', unit: '°', digits: 1 },
  heading: { label: '航向', unit: '°', digits: 1 },
  accelVert: { label: '垂向加速度', unit: 'g', digits: 2 },
};

const CONTROL_META = {
  aileron: { label: '副翼', unit: '', digits: 2 },
  elevator: { label: '升降舵', unit: '', digits: 2 },
  rudder: { label: '方向舵', unit: '', digits: 2 },
  eng1N1: { label: 'ENG1 N1', unit: '%', digits: 1 },
  eng2N1: { label: 'ENG2 N1', unit: '%', digits: 1 },
};

const slider = document.getElementById('timeline-slider');
const playToggle = document.getElementById('play-toggle');
const speedSelect = document.getElementById('speed-select');
const timeMain = document.getElementById('time-main');
const timeSub = document.getElementById('time-sub');
const timelineStart = document.getElementById('timeline-start');
const timelineEnd = document.getElementById('timeline-end');
const loadStatus = document.getElementById('load-status');
const segmentTime = document.getElementById('segment-time');
const segmentRule = document.getElementById('segment-rule');
const loadFullBtn = document.getElementById('load-full');
const showCrashBtn = document.getElementById('show-crash');
const yokeGroup = document.getElementById('yoke-group');
const eng1Fill = document.getElementById('eng1-fill');
const eng2Fill = document.getElementById('eng2-fill');
const eng1Value = document.getElementById('eng1-value');
const eng2Value = document.getElementById('eng2-value');
const rudderDot = document.getElementById('rudder-dot');

function formatValue(value, digits, unit) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return `${value.toFixed(digits)}${unit}`;
}

function formatTimeLabel(seconds, baseTime) {
  if (!Number.isFinite(seconds) || !Number.isFinite(baseTime)) {
    return 'T+00:00.0';
  }
  const delta = Math.max(0, seconds - baseTime);
  const minutes = Math.floor(delta / 60);
  const secs = (delta % 60).toFixed(1).padStart(4, '0');
  return `T+${String(minutes).padStart(2, '0')}:${secs}`;
}

function computeRanges(store) {
  const ranges = {};
  Object.keys(CONTROL_META).forEach((key) => {
    const values = store[key] || [];
    let min = null;
    let max = null;
    values.forEach((val) => {
      if (val === null || val === undefined || Number.isNaN(val)) return;
      min = min === null ? val : Math.min(min, val);
      max = max === null ? val : Math.max(max, val);
    });
    ranges[key] = { min, max };
  });
  return ranges;
}

function normalize(value, range) {
  if (value === null || value === undefined || range.min === null || range.max === null) {
    return 0;
  }
  const mid = (range.min + range.max) / 2;
  const span = range.max - range.min || 1;
  return (value - mid) / (span / 2);
}

function updateReadouts(store, index) {
  Object.entries(FIELD_META).forEach(([key, meta]) => {
    const el = document.querySelector(`[data-field="${key}"]`);
    if (!el) return;
    const value = store[key][index];
    el.textContent = formatValue(value, meta.digits, meta.unit);
  });

  Object.entries(CONTROL_META).forEach(([key, meta]) => {
    const el = document.querySelector(`[data-control="${key}"]`);
    if (!el) return;
    const value = store[key][index];
    el.textContent = formatValue(value, meta.digits, meta.unit);
  });
}

function updateYoke(store, index) {
  const aileron = store.aileron[index];
  const elevator = store.elevator[index];
  const rudder = store.rudder[index];
  const eng1 = store.eng1N1[index];
  const eng2 = store.eng2N1[index];

  const rollNorm = normalize(aileron, STATE.ranges.aileron || { min: -1, max: 1 });
  const pitchNorm = normalize(elevator, STATE.ranges.elevator || { min: -1, max: 1 });

  const translateX = rollNorm * 8;
  const translateY = -pitchNorm * 8;
  const rotate = rollNorm * 12;
  yokeGroup.setAttribute(
    'transform',
    `translate(${translateX} ${translateY}) rotate(${rotate} 100 70)`
  );

  if (Number.isFinite(eng1)) {
    eng1Fill.style.height = `${Math.min(Math.max(eng1, 0), 100)}%`;
    eng1Value.textContent = formatValue(eng1, 1, '%');
  }
  if (Number.isFinite(eng2)) {
    eng2Fill.style.height = `${Math.min(Math.max(eng2, 0), 100)}%`;
    eng2Value.textContent = formatValue(eng2, 1, '%');
  }

  const rudderRange = STATE.ranges.rudder || { min: -1, max: 1 };
  const rudderNorm = normalize(rudder, rudderRange);
  const rudderPos = 50 + rudderNorm * 40;
  rudderDot.style.left = `${rudderPos}%`;
}

function makeSeries(store, key) {
  const points = [];
  for (let i = 0; i < store.time.length; i += 1) {
    const y = store[key][i];
    if (y === null || y === undefined || Number.isNaN(y)) continue;
    points.push({ x: store.time[i], y });
  }
  return points;
}

function buildCharts(store) {
  if (STATE.charts.attitude) {
    STATE.charts.attitude.destroy();
  }
  if (STATE.charts.performance) {
    STATE.charts.performance.destroy();
  }

  const attitudeCtx = document.getElementById('attitude-chart');
  const performanceCtx = document.getElementById('performance-chart');

  STATE.charts.attitude = new Chart(attitudeCtx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: '俯仰角 (Pitch)',
          data: makeSeries(store, 'pitch'),
          borderColor: '#77c0ff',
          borderWidth: 1.5,
          pointRadius: 0,
        },
        {
          label: '滚转角 (Roll)',
          data: makeSeries(store, 'roll'),
          borderColor: '#ffb84d',
          borderWidth: 1.5,
          pointRadius: 0,
        },
        {
          label: '航向 (Heading)',
          data: makeSeries(store, 'heading'),
          borderColor: '#7fffd4',
          borderWidth: 1.5,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      animation: false,
      plugins: {
        legend: {
          labels: { color: '#c9d2df' },
        },
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: '时间 (sec)', color: '#9aa4b2' },
          ticks: { color: '#9aa4b2' },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        y: {
          ticks: { color: '#9aa4b2' },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
      },
    },
  });

  STATE.charts.performance = new Chart(performanceCtx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: '气压高度 (Altitude)',
          data: makeSeries(store, 'altitude'),
          borderColor: '#4ea3ff',
          borderWidth: 1.5,
          pointRadius: 0,
        },
        {
          label: '空速 (Airspeed)',
          data: makeSeries(store, 'airspeed'),
          borderColor: '#a7f3d0',
          borderWidth: 1.5,
          pointRadius: 0,
        },
        {
          label: '垂向加速度 (Vert Accel)',
          data: makeSeries(store, 'accelVert'),
          borderColor: '#f472b6',
          borderWidth: 1.5,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      animation: false,
      plugins: {
        legend: {
          labels: { color: '#c9d2df' },
        },
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: '时间 (sec)', color: '#9aa4b2' },
          ticks: { color: '#9aa4b2' },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        y: {
          ticks: { color: '#9aa4b2' },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
      },
    },
  });
}

function updateTimelineLabels(store) {
  timelineStart.textContent = `${formatTimeLabel(store.startTime, store.baseTime)} (${store.startTime.toFixed(1)}s)`;
  timelineEnd.textContent = `${formatTimeLabel(store.endTime, store.baseTime)} (${store.endTime.toFixed(1)}s)`;
}

function updateTimeDisplay(store) {
  timeMain.textContent = formatTimeLabel(STATE.currentTime, store.baseTime);
  timeSub.textContent = `原始秒数: ${STATE.currentTime.toFixed(4)}s`;
}

function updateUI(store) {
  updateReadouts(store, STATE.currentIndex);
  updateYoke(store, STATE.currentIndex);
  updateTimeDisplay(store);
}

function findIndexByTime(store, time) {
  let low = 0;
  let high = store.time.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midVal = store.time[mid];
    if (midVal < time) {
      low = mid + 1;
    } else if (midVal > time) {
      high = mid - 1;
    } else {
      return mid;
    }
  }
  return Math.min(low, store.time.length - 1);
}

function setTime(store, time) {
  STATE.currentTime = Math.min(Math.max(time, store.startTime), store.endTime);
  STATE.currentIndex = findIndexByTime(store, STATE.currentTime);
  slider.value = STATE.currentTime;
  updateUI(store);
}

function tick(now) {
  if (!STATE.playing) {
    STATE.lastTick = null;
    return;
  }
  if (!STATE.lastTick) {
    STATE.lastTick = now;
  }
  const delta = (now - STATE.lastTick) / 1000;
  STATE.lastTick = now;
  const store = STATE.store;
  const nextTime = STATE.currentTime + delta * STATE.speed;
  if (nextTime >= store.endTime) {
    setTime(store, store.endTime);
    togglePlayback(false);
    return;
  }
  setTime(store, nextTime);
  requestAnimationFrame(tick);
}

function togglePlayback(force) {
  if (typeof force === 'boolean') {
    STATE.playing = force;
  } else {
    STATE.playing = !STATE.playing;
  }
  playToggle.textContent = STATE.playing ? '暂停' : '播放';
  if (STATE.playing) {
    requestAnimationFrame(tick);
  }
}

function configureSlider(store) {
  slider.min = store.startTime;
  slider.max = store.endTime;
  slider.step = 0.05;
  slider.value = store.startTime;
  updateTimelineLabels(store);
}

function setStore(store) {
  STATE.store = store;
  STATE.ranges = computeRanges(store);
  configureSlider(store);
  setTime(store, store.startTime);
  buildCharts(store);
  updateUI(store);
}

function parsePayload(payload) {
  const columns = payload.columns;
  const rows = payload.rows;
  const store = {
    time: [],
    airspeed: [],
    altitude: [],
    pitch: [],
    roll: [],
    heading: [],
    accelVert: [],
    aileron: [],
    elevator: [],
    rudder: [],
    eng1N1: [],
    eng2N1: [],
    baseTime: payload.meta.baseTime,
    startTime: payload.meta.startTime,
    endTime: payload.meta.endTime,
  };
  const index = {};
  columns.forEach((name, idx) => {
    index[name] = idx;
  });
  rows.forEach((row) => {
    store.time.push(row[index.time]);
    store.airspeed.push(row[index.airspeed]);
    store.altitude.push(row[index.altitude]);
    store.pitch.push(row[index.pitch]);
    store.roll.push(row[index.roll]);
    store.heading.push(row[index.heading]);
    store.accelVert.push(row[index.accelVert]);
    store.aileron.push(row[index.aileron]);
    store.elevator.push(row[index.elevator]);
    store.rudder.push(row[index.rudder]);
    store.eng1N1.push(row[index.eng1N1]);
    store.eng2N1.push(row[index.eng2N1]);
  });
  return store;
}

function loadCrashSegment() {
  return fetch('crash_segment.json')
    .then((res) => res.json())
    .then((payload) => {
      META.keySegment = payload.meta;
      segmentTime.textContent = `${payload.meta.startTime.toFixed(2)}s → ${payload.meta.endTime.toFixed(2)}s`;
      segmentRule.textContent = `判定依据: ${payload.meta.criteria}`;
      const store = parsePayload(payload);
      store.baseTime = payload.meta.baseTime;
      store.startTime = payload.meta.startTime;
      store.endTime = payload.meta.endTime;
      STATE.crashStore = store;
      loadStatus.textContent = '已载入关键段 (默认播放)';
      setStore(store);
      togglePlayback(true);
    })
    .catch(() => {
      loadStatus.textContent = '关键段载入失败，请刷新页面重试。';
    });
}

function loadFullData() {
  if (STATE.fullStore) {
    setStore(STATE.fullStore);
    loadStatus.textContent = '已切换为全程数据';
    togglePlayback(false);
    return;
  }
  loadStatus.textContent = '正在解析全程CSV…';
  const store = {
    time: [],
    airspeed: [],
    altitude: [],
    pitch: [],
    roll: [],
    heading: [],
    accelVert: [],
    aileron: [],
    elevator: [],
    rudder: [],
    eng1N1: [],
    eng2N1: [],
    baseTime: null,
    startTime: null,
    endTime: null,
  };
  let header = null;
  let columnIndex = null;
  let skippedUnits = false;
  let skippedTypes = false;
  Papa.parse('ExactSample.csv', {
    download: true,
    skipEmptyLines: true,
    worker: true,
    step: (results) => {
      const row = results.data;
      if (!header) {
        if (row[0] === 'Time') {
          header = row;
          columnIndex = {
            airspeed: header.indexOf('Airspeed Comp'),
            altitude: header.indexOf('Altitude Press'),
            pitch: header.indexOf('Pitch Angle'),
            roll: header.indexOf('Roll Angle'),
            heading: header.indexOf('Heading'),
            accelVert: header.indexOf('Accel Vert'),
            aileron: header.indexOf('Aileron-L'),
            elevator: header.indexOf('Elevator-L'),
            rudder: header.indexOf('Rudder'),
            eng1N1: header.indexOf('Eng1 N1'),
            eng2N1: header.indexOf('Eng2 N1'),
          };
        }
        return;
      }
      if (!skippedUnits) {
        skippedUnits = true;
        return;
      }
      if (!skippedTypes) {
        skippedTypes = true;
        return;
      }
      if (!row[0]) return;
      const time = Number.parseFloat(row[0]);
      if (!Number.isFinite(time)) return;

      const get = (key) => {
        const idx = columnIndex?.[key] ?? -1;
        if (idx === -1 || idx >= row.length) return null;
        const val = row[idx];
        if (val === '' || val === undefined) return null;
        const num = Number.parseFloat(val);
        return Number.isFinite(num) ? num : null;
      };

      if (store.baseTime === null) {
        store.baseTime = time;
        store.startTime = time;
      }
      store.endTime = time;
      store.time.push(time);
      store.airspeed.push(get('airspeed'));
      store.altitude.push(get('altitude'));
      store.pitch.push(get('pitch'));
      store.roll.push(get('roll'));
      store.heading.push(get('heading'));
      store.accelVert.push(get('accelVert'));
      store.aileron.push(get('aileron'));
      store.elevator.push(get('elevator'));
      store.rudder.push(get('rudder'));
      store.eng1N1.push(get('eng1N1'));
      store.eng2N1.push(get('eng2N1'));

      if (store.time.length % 20000 === 0) {
        loadStatus.textContent = `正在解析全程CSV…已载入 ${store.time.length.toLocaleString()} 行`;
      }
    },
    complete: () => {
      STATE.fullStore = store;
      loadStatus.textContent = '全程数据已载入，可拖动时间轴查看。';
      setStore(store);
      togglePlayback(false);
    },
    error: () => {
      loadStatus.textContent = '全程CSV加载失败，请稍后重试。';
    },
  });
}

slider.addEventListener('input', (event) => {
  const value = Number.parseFloat(event.target.value);
  if (!STATE.store) return;
  setTime(STATE.store, value);
});

playToggle.addEventListener('click', () => {
  togglePlayback();
});

speedSelect.addEventListener('change', (event) => {
  STATE.speed = Number.parseFloat(event.target.value);
});

loadFullBtn.addEventListener('click', () => {
  loadFullData();
});

showCrashBtn.addEventListener('click', () => {
  if (!STATE.crashStore) return;
  setStore(STATE.crashStore);
  loadStatus.textContent = '已切换为关键段播放';
  togglePlayback(false);
});

loadCrashSegment();
