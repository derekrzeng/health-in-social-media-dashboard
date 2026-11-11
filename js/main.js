/* global Chart, coreui */

/**
 * --------------------------------------------------------------------------
 * CoreUI Boostrap Admin Template main.js
 * Licensed under MIT (https://github.com/coreui/coreui-free-bootstrap-admin-template/blob/main/LICENSE)
 * --------------------------------------------------------------------------
 */

/**
 * Dashboard (index.html)
 *
 * Loads data/subreddits.json and each ready community's files from data/subreddits/<name>/
 * (format: data/README.md), then draws everything for the community picked in the header,
 * for either its posts or its comments (the Posts | Comments toggle):
 * - Stat cards with per-year sparklines
 * - Main chart (posts per month), poster/post type doughnuts and posts list, with hand or
 *   model labels (the Hand | Model toggle)
 * - Actual vs. Predicted chart, Agreement (hand vs. model) and the Post Map
 * - Compare Communities table (all ready communities side by side)
 *
 * All charts use Chart.js with CoreUI's custom tooltips and color variables.
 */

// Configure Chart.js defaults for custom tooltips
Chart.defaults.pointHitDetectionRadius = 1;
Chart.defaults.plugins.tooltip.enabled = false;
Chart.defaults.plugins.tooltip.mode = 'index';
Chart.defaults.plugins.tooltip.position = 'nearest';
Chart.defaults.plugins.tooltip.external = coreui.ChartJS.customTooltips;
Chart.defaults.defaultFontColor = coreui.Utils.getStyle('--cui-body-color');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// All dates are handled as UTC midnight so local time zones can't shift a post into another day.
const parseISODate = value => {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};
const formatDate = (time, options) => new Date(time).toLocaleDateString('en-US', {timeZone: 'UTC', ...options});
const monthStart = time => {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
};
const nextMonth = time => {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
};
const yearOf = time => new Date(time).getUTCFullYear();

const SHORT_DATE = {month: 'short', day: 'numeric', year: 'numeric'};
const MONTH_YEAR = {month: 'long', year: 'numeric'};
const formatRange = (from, to) => `${formatDate(from, SHORT_DATE)} to ${formatDate(to, SHORT_DATE)}`;
const pluralize = (count, word) => `${count.toLocaleString('en-US')} ${count === 1 ? word : `${word}s`}`;
const formatPercent = share => (share > 0 && share < 0.005 ? '<1%' : `${Math.round(share * 100)}%`);
const unique = values => [...new Set(values)];

// Small DOM helper: element with optional class names and text (text is never parsed as HTML)
const createElement = (tag, className = '', text = '') => {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text) {
    element.textContent = text;
  }
  return element;
};

// ---------------------------------------------------------------------------
// Data loading: data/subreddits.json lists the communities; each ready one has
// data/subreddits/<name>/posts.json and, if listed as available, comments.json,
// predictions.csv and post_map.csv
// ---------------------------------------------------------------------------
const fetchText = async path => {
  const response = await fetch(path, {cache: 'no-cache'});
  if (!response.ok) {
    throw new Error(`${path} could not be loaded (${response.status} ${response.statusText})`);
  }
  return response.text();
};
const fetchJSON = async path => JSON.parse(await fetchText(path));

// CSV with a header row → one object per row, keyed by column name (values trimmed; quotes allowed)
const parseCSV = text => {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') {
        index++;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header = [], ...body] = rows.filter(cells => cells.some(cell => cell.trim() !== ''));
  return body.map(cells => Object.fromEntries(header.map((name, index) => [name.trim(), (cells[index] ?? '').trim()])));
};
const fetchCSV = async path => parseCSV(await fetchText(path));

// Fixed color order, checked for color-vision deficiencies with the dataviz palette validator.
// A category keeps its color whatever its rank; "Unknown" is always neutral gray.
const CATEGORY_COLORS = ['#9b2018', '#c79e41', '#3862a7', '#5cc6b9', '#59894f'];
const NEUTRAL_COLOR = '#aab3c5';
const colorsFor = order => {
  const colors = new Map();
  let slot = 0;
  for (const name of order) {
    colors.set(name, name === 'Unknown' ? NEUTRAL_COLOR : CATEGORY_COLORS[slot++] || NEUTRAL_COLOR);
  }
  return colors;
};

const loadSubreddit = async subreddit => {
  const folder = `data/subreddits/${encodeURIComponent(subreddit.name)}`;
  const [postsFile, predictionRows, commentsFile, mapRows] = await Promise.all([
    fetchJSON(`${folder}/posts.json`),
    // Optional files are only requested when listed, so a community without them doesn't log a 404
    subreddit.predictions ? fetchCSV(`${folder}/predictions.csv`) : null,
    subreddit.comments ? fetchJSON(`${folder}/comments.json`) : null,
    subreddit.post_map ? fetchCSV(`${folder}/post_map.csv`) : null
  ]);
  if (!Array.isArray(postsFile?.posts) || postsFile.posts.length === 0) {
    throw new Error(`${folder}/posts.json has no posts`);
  }

  // Oldest first (the sort is stable, so posts on the same day keep their file order).
  // A post's id is its "id" field, or else Reddit's id from its link (comments refer to posts by it).
  const posts = postsFile.posts
    .map(post => ({
      ...post,
      id: post.id ?? post.url?.match(/\/comments\/([a-z0-9]+)\//i)?.[1],
      what: [].concat(post.what ?? []),
      time: parseISODate(post.date)
    }))
    .sort((a, b) => a.time - b.time);
  const range = postsFile.range ?? {start: posts[0].date, end: posts.at(-1).date};
  const whoOrder = postsFile.who_order ?? unique(posts.map(post => post.who));
  const whatOrder = postsFile.what_order ?? unique(posts.flatMap(post => post.what));
  const postsById = new Map(posts.filter(post => post.id).map(post => [post.id, post]));

  // Comments (optional): only those whose post is in posts.json are used
  let comments = null;
  if (commentsFile) {
    comments = (commentsFile.comments ?? [])
      .filter(comment => postsById.has(comment.post_id))
      .map(comment => ({
        ...comment,
        post: postsById.get(comment.post_id),
        what: [].concat(comment.what ?? []),
        time: parseISODate(comment.date)
      }))
      .sort((a, b) => a.time - b.time);
  }
  const commentsByPost = new Map();
  for (const comment of comments ?? []) {
    if (!commentsByPost.has(comment.post_id)) {
      commentsByPost.set(comment.post_id, []);
    }
    commentsByPost.get(comment.post_id).push(comment);
  }
  // Model labels (optional): per model, post id → {who, what, split}. Rows for unknown posts are skipped.
  const models = unique((predictionRows ?? []).map(row => row.model).filter(Boolean));
  const modelLabels = new Map(models.map(model => [model, new Map()]));
  for (const row of predictionRows ?? []) {
    if (row.model && postsById.has(row.post_id) && (row.poster_type || row.post_type)) {
      modelLabels.get(row.model).set(row.post_id, {
        who: row.poster_type || null,
        what: row.post_type || null,
        split: row.split?.toLowerCase() === 'oof' ? 'oof' : 'test'
      });
    }
  }
  // Category orders and colors cover hand and model labels, starting with the posts' own order
  const labelWhoOrder = unique([...whoOrder, ...[...modelLabels.values()].flatMap(labels => [...labels.values()].map(label => label.who)).filter(Boolean)]);
  const labelWhatOrder = unique([...whatOrder, ...[...modelLabels.values()].flatMap(labels => [...labels.values()].map(label => label.what)).filter(Boolean)]);

  // Post map (optional): post id → {x, y, topic}; topic is null until BERTopic ids are filled in
  const mapPoints = new Map();
  for (const row of mapRows ?? []) {
    const x = Number.parseFloat(row.x);
    const y = Number.parseFloat(row.y);
    if (postsById.has(row.post_id) && Number.isFinite(x) && Number.isFinite(y)) {
      const topic = row.topic_id === '' || row.topic_id === undefined ? null : Number(row.topic_id);
      mapPoints.set(row.post_id, {x, y, topic: Number.isFinite(topic) ? topic : null});
    }
  }

  // Comment labels are optional; orders start with the posts' so a category keeps its color
  const commentWhoOrder = unique([...whoOrder, ...(comments ?? []).map(comment => comment.who).filter(Boolean)]);
  const commentWhatOrder = unique([...whatOrder, ...(comments ?? []).flatMap(comment => comment.what)]);

  return {
    ...subreddit,
    posts,
    range,
    start: parseISODate(range.start),
    end: parseISODate(range.end),
    whoOrder,
    whatOrder,
    whoColors: colorsFor(labelWhoOrder),
    whatColors: colorsFor(labelWhatOrder),
    labelWhoOrder,
    labelWhatOrder,
    models,
    modelLabels,
    mapPoints,
    mapMethod: mapRows?.find(row => row.method)?.method ?? '',
    comments: comments?.length ? comments : null,
    commentsByPost,
    commentsHaveWho: Boolean(comments?.some(comment => comment.who)),
    commentsHaveWhat: Boolean(comments?.some(comment => comment.what.length > 0)),
    commentWhoOrder,
    commentWhatOrder,
    commentWhoColors: colorsFor(commentWhoOrder),
    commentWhatColors: colorsFor(commentWhatOrder),
    // Comments can come after the last post, so their date range can run later
    commentRange: comments?.length ? {
      start: [range.start, comments[0].date].sort()[0],
      end: [range.end, comments.at(-1).date].sort()[1]
    } : range
  };
};

// ---------------------------------------------------------------------------
// Date range controls (shared by the dashboard charts)
// ---------------------------------------------------------------------------

// Wires up the `<prefix>-from`, `<prefix>-to`, `<prefix>-reset` and `<prefix>-error` elements.
// Calls onChange(from, to) with a valid range (UTC timestamps) clamped to the data's period.
// setBounds({start, end}) sets that period (YYYY-MM-DD) and resets the inputs to it, unless
// keepValues is set and the dates were changed (then they stay and are clamped to the new period).
const createDateRange = (prefix, onChange) => {
  const fromInput = document.getElementById(`${prefix}-from`);
  const toInput = document.getElementById(`${prefix}-to`);
  const errorElement = document.getElementById(`${prefix}-error`);
  let bounds = null;

  const showError = message => {
    errorElement.textContent = message;
    fromInput.classList.toggle('is-invalid', Boolean(message));
    toInput.classList.toggle('is-invalid', Boolean(message));
  };

  const update = () => {
    if (!bounds) {
      return;
    }
    if (!fromInput.value || !toInput.value) {
      showError('Enter both a start and an end date.');
      return;
    }
    if (fromInput.value > toInput.value) {
      showError('The start date must be on or before the end date.');
      return;
    }
    const from = Math.max(parseISODate(fromInput.value), parseISODate(bounds.start));
    const to = Math.min(parseISODate(toInput.value), parseISODate(bounds.end));
    if (from > to) {
      showError(`Data covers ${formatRange(parseISODate(bounds.start), parseISODate(bounds.end))}.`);
      return;
    }
    showError('');
    onChange(from, to);
  };

  const reset = () => {
    fromInput.value = bounds.start;
    toInput.value = bounds.end;
    update();
  };

  for (const input of [fromInput, toInput]) {
    input.addEventListener('change', update);
  }
  document.getElementById(`${prefix}-reset`).addEventListener('click', () => bounds && reset());

  return {
    reset: () => bounds && reset(),
    setBounds(range, {keepValues = false} = {}) {
      const previous = bounds;
      bounds = range;
      for (const input of [fromInput, toInput]) {
        input.min = range.start;
        input.max = range.end;
      }
      if (keepValues && previous && fromInput.value && toInput.value) {
        // A date left at the edge of the old period moves to the edge of the new one;
        // chosen dates stay, kept inside the new period (ISO dates compare as strings)
        const clamp = value => [range.start, value, range.end].sort()[1];
        fromInput.value = fromInput.value === previous.start ? range.start : clamp(fromInput.value);
        toInput.value = toInput.value === previous.end ? range.end : clamp(toInput.value);
        update();
      } else {
        reset();
      }
    }
  };
};

// The community currently shown (set by showSubreddit) and whether posts or comments are shown
let current = null;
let mode = 'posts';
const isComments = () => mode === 'comments';
const NOT_AVAILABLE = 'Not available for comments yet.';

// What the charts and list count in the current mode (null: no comment data for this community)
const items = () => (isComments() ? current.comments : current.posts);
const itemWord = () => (isComments() ? 'comment' : 'post');
const modeRange = () => (isComments() ? current.commentRange : current.range);

// Hand | Model toggle: which labels the type charts and list badges show. Model labels are for
// posts only, from the model picked in any .model-select (they all stay in sync).
const NOT_AVAILABLE_YET = 'Not available yet.';
let labelSource = 'hand';
let selectedModel = null;
const useModel = () => labelSource === 'model' && !isComments();
const modelLabelFor = post => current.modelLabels.get(selectedModel)?.get(post.id) ?? null;
const modelHas = field => [...(current.modelLabels.get(selectedModel)?.values() ?? [])].some(label => label[field]);

// When a post has several hand post types, it agrees if the model picked any of them
const handWhatFor = (post, modelWhat) => (modelWhat && post.what.includes(modelWhat) ? modelWhat : post.what[0] ?? null);
const disagrees = post => {
  const label = modelLabelFor(post);
  return Boolean(label && ((label.who && label.who !== post.who) || (label.what && !post.what.includes(label.what))));
};

// Labels shown for a post: the model's where it has one (Model view), otherwise the hand labels
const shownWho = post => (useModel() && modelLabelFor(post)?.who) || post.who;
const shownWhat = post => {
  const modelWhat = useModel() ? modelLabelFor(post)?.what : null;
  return modelWhat ? [modelWhat] : post.what;
};

// Shows a section's content, or its "not available" message
const setAvailable = (key, available, message = NOT_AVAILABLE) => {
  for (const element of document.querySelectorAll(`[data-mode-content="${key}"]`)) {
    element.classList.toggle('d-none', !available);
  }
  for (const element of document.querySelectorAll(`[data-mode-na="${key}"]`)) {
    element.classList.toggle('d-none', available);
    if (!available) {
      element.textContent = message;
    }
  }
};

// Swaps titles and labels marked with data-comments-text / data-comments-aria
const applyModeText = () => {
  for (const element of document.querySelectorAll('[data-comments-text]')) {
    element.dataset.postsText ??= element.textContent;
    element.textContent = isComments() ? element.dataset.commentsText : element.dataset.postsText;
  }
  for (const element of document.querySelectorAll('[data-comments-aria]')) {
    element.dataset.postsAria ??= element.getAttribute('aria-label');
    element.setAttribute('aria-label', isComments() ? element.dataset.commentsAria : element.dataset.postsAria);
  }
};

// ---------------------------------------------------------------------------
// Stat cards
// ---------------------------------------------------------------------------
// Count per calendar year over a period ({start, end} as YYYY-MM-DD), including empty years
const countPerYear = (list, range) => {
  const years = [];
  for (let year = Number(range.start.slice(0, 4)); year <= Number(range.end.slice(0, 4)); year++) {
    years.push(year);
  }
  const counts = new Map(years.map(year => [year, 0]));
  for (const item of list) {
    const year = yearOf(item.time);
    counts.set(year, (counts.get(year) || 0) + 1);
  }
  return {years, counts: years.map(year => counts.get(year))};
};
const busiestOf = ({years, counts}) => {
  const index = counts.indexOf(Math.max(...counts));
  return {year: years[index], count: counts[index]};
};
const postsPerYear = community => countPerYear(community.posts, community.range);

// Every post has a numeric comment count, so the total is meaningful
const hasCommentData = community => community.posts.every(post => Number.isFinite(post.comments));
const totalComments = community => community.posts.reduce((sum, post) => sum + post.comments, 0);
const patientShare = list => list.filter(item => item.who === 'Patient').length / list.length;
const busiestYear = community => busiestOf(postsPerYear(community));

// Sparklines follow the CoreUI template's widget cards: line, line, area, bar.
// Line color follows the card's text color (white on maroon, dark on gold).
const sparkColor = (canvas, alpha) => {
  const rgb = getComputedStyle(canvas).color.match(/\d+/g).slice(0, 3).join(', ');
  return `rgba(${rgb}, ${alpha})`;
};
const createSparkline = (id, type, {fill = false} = {}) => {
  const canvas = document.getElementById(id);
  return new Chart(canvas, {
    type,
    data: {
      labels: [],
      datasets: [{
        label: 'Posts',
        data: [],
        borderColor: sparkColor(canvas, 0.55),
        backgroundColor: type === 'bar' || fill ? sparkColor(canvas, 0.2) : 'transparent',
        pointBackgroundColor: sparkColor(canvas, 1),
        fill,
        barPercentage: 0.6
      }]
    },
    options: {
      plugins: {
        legend: {
          display: false
        }
      },
      maintainAspectRatio: false,
      scales: {
        x: {
          display: false
        },
        y: {
          display: false,
          beginAtZero: true
        }
      },
      elements: {
        line: {
          borderWidth: fill ? 2 : 1,
          tension: 0.4
        },
        point: {
          radius: fill ? 0 : 4,
          hitRadius: 10,
          hoverRadius: 4
        }
      }
    }
  });
};
const sparklines = [
  createSparkline('card-chart1', 'line'),
  createSparkline('card-chart2', 'line'),
  createSparkline('card-chart3', 'line', {fill: true}),
  createSparkline('card-chart4', 'bar')
];

const setStat = (id, value, label) => {
  document.getElementById(id).textContent = value;
  document.getElementById(`${id}-label`).textContent = label;
};

const updateSparklines = ({years, counts}, label) => {
  for (const chart of sparklines) {
    chart.data.labels = years.map(String);
    chart.data.datasets[0].label = label;
    chart.data.datasets[0].data = counts;
    // Headroom so the line charts' points aren't clipped at the top of the card
    chart.options.scales.y.max = chart.config.type === 'line' && !chart.data.datasets[0].fill && counts.length > 0 ? Math.max(...counts) * 1.15 : undefined;
    chart.update();
  }
};

const updateStatCards = () => {
  const community = current;
  if (isComments()) {
    const {comments} = community;
    if (!comments) {
      updateSparklines({years: [], counts: []}, 'Comments');
      setStat('stat-first', 'n/a', 'Comments');
      setStat('stat-second', 'n/a', 'Comments per post');
      setStat('stat-patient-share', 'n/a', 'Patient commenters');
      setStat('stat-busiest-year', 'n/a', 'Busiest year');
      return;
    }
    const perYear = countPerYear(comments, community.commentRange);
    const busiest = busiestOf(perYear);
    updateSparklines(perYear, 'Comments');
    setStat('stat-first', comments.length.toLocaleString('en-US'), 'Comments');
    setStat('stat-second', (comments.length / community.posts.length).toFixed(1), 'Comments per post');
    setStat('stat-patient-share', community.commentsHaveWho ? formatPercent(patientShare(comments)) : 'n/a', 'Patient commenters');
    setStat('stat-busiest-year', String(busiest.year), `Busiest year, ${pluralize(busiest.count, 'comment')}`);
    return;
  }

  const perYear = postsPerYear(community);
  const busiest = busiestOf(perYear);
  updateSparklines(perYear, 'Posts');
  setStat('stat-first', community.posts.length.toLocaleString('en-US'), 'Posts');

  // Comment counts come with each post; fall back to the test set size if they're missing
  if (hasCommentData(community)) {
    setStat('stat-second', totalComments(community).toLocaleString('en-US'), 'Comments');
  } else {
    const labeled = new Set([...community.modelLabels.values()].flatMap(labels => [...labels.keys()]));
    setStat('stat-second', labeled.size > 0 ? labeled.size.toLocaleString('en-US') : 'n/a', 'Test posts');
  }

  setStat('stat-patient-share', formatPercent(patientShare(community.posts)), 'Patient posters');
  setStat('stat-busiest-year', String(busiest.year), `Busiest year, ${pluralize(busiest.count, 'post')}`);
};

// ---------------------------------------------------------------------------
// Main chart: posts per month, filtered by a date range. Its range also drives
// the doughnuts and the posts list.
// ---------------------------------------------------------------------------

// Counts posts per month between `from` and `to` (inclusive). Months with no posts are included
// as 0. If the range starts or ends mid-month, only the days inside the range are counted.
const countPostsPerMonth = (posts, from, to) => {
  const labels = [];
  const counts = [];
  const indexByMonth = new Map();
  for (let time = monthStart(from); time <= to; time = nextMonth(time)) {
    indexByMonth.set(time, counts.length);
    labels.push(formatDate(time, {month: 'short', year: 'numeric'}));
    counts.push(0);
  }
  for (const post of posts) {
    if (post.time >= from && post.time <= to) {
      counts[indexByMonth.get(monthStart(post.time))] += 1;
    }
  }
  return {labels, counts};
};

const mainChart = new Chart(document.getElementById('main-chart'), {
  type: 'line',
  data: {
    labels: [],
    datasets: [{
      label: 'Posts',
      backgroundColor: `rgba(${coreui.Utils.getStyle('--cui-info-rgb')}, .1)`,
      borderColor: coreui.Utils.getStyle('--cui-info'),
      pointHoverBackgroundColor: '#fff',
      borderWidth: 2,
      data: [],
      fill: true,
      // Smooth curve that never overshoots below 0 between empty periods
      cubicInterpolationMode: 'monotone'
    }]
  },
  options: {
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      }
    },
    scales: {
      x: {
        grid: {
          color: coreui.Utils.getStyle('--cui-border-color-translucent'),
          drawOnChartArea: false
        },
        ticks: {
          color: coreui.Utils.getStyle('--cui-body-color'),
          maxRotation: 0,
          autoSkipPadding: 16
        }
      },
      y: {
        border: {
          color: coreui.Utils.getStyle('--cui-border-color-translucent')
        },
        beginAtZero: true,
        grid: {
          color: coreui.Utils.getStyle('--cui-border-color-translucent')
        },
        ticks: {
          color: coreui.Utils.getStyle('--cui-body-color'),
          maxTicksLimit: 6,
          precision: 0
        }
      }
    },
    elements: {
      point: {
        radius: 0,
        hitRadius: 10,
        hoverRadius: 4,
        hoverBorderWidth: 3
      }
    }
  }
});

document.documentElement.addEventListener('ColorSchemeChange', () => {
  mainChart.options.scales.x.grid.color = coreui.Utils.getStyle('--cui-border-color-translucent');
  mainChart.options.scales.x.ticks.color = coreui.Utils.getStyle('--cui-body-color');
  mainChart.options.scales.y.border.color = coreui.Utils.getStyle('--cui-border-color-translucent');
  mainChart.options.scales.y.grid.color = coreui.Utils.getStyle('--cui-border-color-translucent');
  mainChart.options.scales.y.ticks.color = coreui.Utils.getStyle('--cui-body-color');
  mainChart.update();
});

// ---------------------------------------------------------------------------
// Poster type / post type doughnuts (follow the line chart's date range)
// ---------------------------------------------------------------------------
const swatch = color => {
  const element = createElement('span', 'swatch');
  element.style.background = color;
  return element;
};

// Builds one doughnut with its legend table; returns update(order, colors, counts, itemCount, word) → total counted
const createBreakdown = prefix => {
  const legend = document.getElementById(`${prefix}-legend`);
  const center = document.getElementById(`${prefix}-center`);
  const chart = new Chart(document.getElementById(`${prefix}-chart`), {
    type: 'doughnut',
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: [],
        borderColor: '#fff',
        borderWidth: 2,
        hoverOffset: 4
      }]
    },
    options: {
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: context => {
              const total = context.dataset.data.reduce((sum, count) => sum + count, 0);
              return `${context.label}: ${context.parsed} (${formatPercent(context.parsed / total)})`;
            }
          }
        }
      }
    }
  });

  return (order, colors, counts, itemCount, word) => {
    const rows = order.map(name => ({name, count: counts.get(name) || 0}));
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    chart.data.labels = order;
    chart.data.datasets[0].backgroundColor = order.map(name => colors.get(name));
    chart.data.datasets[0].data = rows.map(row => row.count);
    chart.update();

    center.replaceChildren(createElement('strong', '', itemCount.toLocaleString('en-US')), createElement('span', '', itemCount === 1 ? word : `${word}s`));

    const legendRows = rows.filter(row => row.count > 0).map(row => {
      const tr = createElement('tr');
      const name = createElement('td');
      name.append(swatch(colors.get(row.name)), row.name);
      tr.append(name, createElement('td', 'num', String(row.count)), createElement('td', 'num text-body-secondary', formatPercent(row.count / total)));
      return tr;
    });
    if (legendRows.length === 0) {
      const tr = createElement('tr');
      tr.append(createElement('td', 'text-body-secondary', `No ${word}s in this range.`));
      legendRows.push(tr);
    }
    const tbody = createElement('tbody');
    tbody.append(...legendRows);
    legend.replaceChildren(tbody);
    return total;
  };
};

const updateWhoBreakdown = createBreakdown('who');
const updateWhatBreakdown = createBreakdown('what');
const breakdownSubtitle = document.getElementById('breakdown-subtitle');
const whatNote = document.getElementById('what-note');

// Poster/post type doughnuts for the posts or comments in range, from hand or model labels.
// Each doughnut says "not available" when its labels are missing: comments without "who" /
// "what", or a model that doesn't predict that field. In the Model view, only posts the model
// labeled are counted.
const breakdownSource = field => {
  const order = field === 'who' ? 'Who' : 'What';
  if (isComments()) {
    const has = field === 'who' ? current.commentsHaveWho : current.commentsHaveWhat;
    return has && {
      labelsOf: comment => (field === 'who' ? [comment.who].filter(Boolean) : comment.what),
      order: current[`comment${order}Order`],
      colors: current[`comment${order}Colors`]
    };
  }
  if (useModel()) {
    return modelHas(field) && {
      labelsOf: post => [modelLabelFor(post)?.[field]].filter(Boolean),
      order: current[`label${order}Order`],
      colors: current[`${field}Colors`]
    };
  }
  return {
    labelsOf: post => (field === 'who' ? [post.who] : post.what),
    order: current[`${field}Order`],
    colors: current[`${field}Colors`]
  };
};

const updateBreakdowns = (list, from, to) => {
  const word = itemWord();
  const missing = isComments() ? NOT_AVAILABLE : NOT_AVAILABLE_YET;
  whatNote.textContent = '';
  let counted = useModel() ? 0 : list.length;
  for (const [field, update] of [['who', updateWhoBreakdown], ['what', updateWhatBreakdown]]) {
    const source = breakdownSource(field);
    setAvailable(field, Boolean(source), missing);
    if (!source) {
      continue;
    }
    const labeled = list.filter(item => source.labelsOf(item).length > 0);
    const counts = new Map();
    for (const item of labeled) {
      for (const label of source.labelsOf(item)) {
        counts.set(label, (counts.get(label) || 0) + 1);
      }
    }
    const labelTotal = update(source.order, source.colors, counts, labeled.length, word);
    if (useModel()) {
      counted = labeled.length;
    }
    // A few posts have more than one post type, so that doughnut counts labels rather than posts
    if (field === 'what' && labelTotal > labeled.length) {
      const multiLabel = labeled.filter(item => source.labelsOf(item).length > 1).length;
      whatNote.textContent = `Counts labels, not ${word}s: ${pluralize(multiLabel, word)} ${multiLabel === 1 ? 'has' : 'have'} more than one ${word} type.`;
    }
  }
  breakdownSubtitle.textContent = useModel() && selectedModel ?
    `${formatRange(from, to)}, ${selectedModel} labels for ${counted} of ${pluralize(list.length, word)}` :
    `${formatRange(from, to)}, ${pluralize(list.length, word)}`;
};

// ---------------------------------------------------------------------------
// List of posts or comments: 10 per page, filterable (follows the line chart's date range)
// ---------------------------------------------------------------------------
const POSTS_PER_PAGE = 10;
const COMMENT_PREVIEW_LENGTH = 400;
const postsList = document.getElementById('posts-list');
const postsSummary = document.getElementById('posts-summary');
const postsPageInfo = document.getElementById('posts-page-info');
const postsPagination = document.getElementById('posts-pagination');
const postsWhoSelect = document.getElementById('posts-who');
const postsWhatSelect = document.getElementById('posts-what');
const postsDisagree = document.getElementById('posts-disagree');
const postsState = {inRange: [], page: 1, expanded: new Set()};

// Refills a filter dropdown with categories under an "All ..." option; no categories disables it
const setFilterOptions = (select, allLabel, names) => {
  select.replaceChildren(new Option(allLabel, ''));
  for (const name of names) {
    select.add(new Option(name, name));
  }
  select.value = '';
  select.disabled = names.length === 0;
};

const updateFilters = () => {
  if (isComments()) {
    // Only the types the comments actually use
    const used = new Set(current.comments?.flatMap(comment => [comment.who, ...comment.what]) ?? []);
    setFilterOptions(postsWhoSelect, 'All commenter types', current.commentWhoOrder.filter(name => used.has(name)));
    setFilterOptions(postsWhatSelect, 'All comment types', current.commentWhatOrder.filter(name => used.has(name)));
  } else {
    setFilterOptions(postsWhoSelect, 'All poster types', useModel() ? current.labelWhoOrder : current.whoOrder);
    setFilterOptions(postsWhatSelect, 'All post types', useModel() ? current.labelWhatOrder : current.whatOrder);
  }
  // Disagreements need model labels, which are for posts only
  const canCompare = !isComments() && Boolean(selectedModel);
  postsDisagree.disabled = !canCompare;
  if (!canCompare) {
    postsDisagree.checked = false;
  }
};

const postBadge = (label, variant) => createElement('span', `badge text-bg-${variant}`, label);
const shorten = text => (text.length > COMMENT_PREVIEW_LENGTH ? `${text.slice(0, COMMENT_PREVIEW_LENGTH).trimEnd()}…` : text);
const scoreText = score => (Number.isFinite(score) ? pluralize(score, 'point') : '');

// Reddit links only; anything else stays plain text
const linkIfReddit = (element, url) => {
  if (/^https:\/\/(www\.)?reddit\.com\//.test(url ?? '')) {
    element.href = url;
    element.target = '_blank';
    element.rel = 'noopener noreferrer';
  }
  return element;
};

const itemMeta = (item, badges = null) => {
  const meta = createElement('div', 'd-flex flex-wrap align-items-center gap-2 small text-body-secondary my-1');
  meta.append(createElement('span', '', formatDate(item.time, SHORT_DATE)));
  if (badges) {
    meta.append(...badges);
    return meta;
  }
  if (item.who) {
    meta.append(postBadge(item.who, 'primary'));
  }
  meta.append(...item.what.map(what => postBadge(what, 'info')));
  return meta;
};

// A post's labels from the current source; where hand and model differ, the other one is added
// as a gray "Hand: ..." / "Model: ..." badge
const postBadges = post => {
  const badges = [postBadge(shownWho(post), 'primary'), ...shownWhat(post).map(what => postBadge(what, 'info'))];
  const label = modelLabelFor(post);
  if (label) {
    const other = useModel() ? 'Hand' : 'Model';
    if (label.who && label.who !== post.who) {
      badges.push(postBadge(`${other}: ${useModel() ? post.who : label.who}`, 'secondary'));
    }
    if (label.what && !post.what.includes(label.what)) {
      const otherWhats = useModel() ? post.what : [label.what];
      badges.push(...otherWhats.map(what => postBadge(`${other}: ${what}`, 'secondary')));
    }
  }
  return badges;
};

// A post's comments as a thread: replies sit under the comment they answer
const commentThread = post => {
  const comments = current.commentsByPost.get(post.id) ?? [];
  const ids = new Set(comments.map(comment => comment.id).filter(Boolean));
  const replies = new Map();
  for (const comment of comments) {
    const parent = comment.parent_id && ids.has(comment.parent_id) ? comment.parent_id : null;
    if (!replies.has(parent)) {
      replies.set(parent, []);
    }
    replies.get(parent).push(comment);
  }
  const renderLevel = (parent, depth) => {
    // Indent replies, but stop indenting after a few levels so deep threads stay readable
    const list = createElement('ul', `list-unstyled mb-0${depth > 0 && depth <= 4 ? ' ms-3' : ''}`);
    for (const comment of replies.get(parent) ?? []) {
      const item = createElement('li', 'mt-2');
      item.append(itemMeta(comment), createElement('div', '', comment.body ?? ''));
      const score = scoreText(comment.score);
      if (score) {
        item.append(createElement('div', 'small text-body-secondary', score));
      }
      if (comment.id && replies.has(comment.id)) {
        item.append(renderLevel(comment.id, depth + 1));
      }
      list.append(item);
    }
    return list;
  };
  const thread = renderLevel(null, 0);
  thread.id = `comments-${post.id}`;
  return thread;
};

const postItem = post => {
  const item = createElement('li', 'list-group-item py-3');
  if (post.id) {
    item.id = `post-${post.id}`;
  }
  item.append(linkIfReddit(createElement('a', 'post-title', post.title || '(untitled post)'), post.url), itemMeta(post, postBadges(post)));
  if (post.snippet) {
    item.append(createElement('p', 'mb-1', post.snippet));
  }
  const stats = [scoreText(post.score), Number.isFinite(post.comments) && pluralize(post.comments, 'comment')].filter(Boolean);
  if (stats.length > 0) {
    item.append(createElement('div', 'small text-body-secondary', stats.join(', ')));
  }

  // "View comments" only when this post has comments in the data
  const commentCount = current.commentsByPost.get(post.id)?.length ?? 0;
  if (commentCount > 0) {
    const expanded = postsState.expanded.has(post.id);
    const toggle = createElement('button', 'btn btn-link btn-sm p-0 mt-1', expanded ? 'Hide comments' : `View comments (${commentCount})`);
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-controls', `comments-${post.id}`);
    toggle.addEventListener('click', () => {
      if (postsState.expanded.has(post.id)) {
        postsState.expanded.delete(post.id);
      } else {
        postsState.expanded.add(post.id);
      }
      item.replaceWith(postItem(post));
    });
    item.append(createElement('div'));
    item.lastChild.append(toggle);
    if (expanded) {
      item.append(commentThread(post));
    }
  }
  return item;
};

const commentItem = comment => {
  const item = createElement('li', 'list-group-item py-3');
  item.append(itemMeta(comment), createElement('p', 'mb-1', shorten(comment.body ?? '')));
  const footer = createElement('div', 'small text-body-secondary');
  const score = scoreText(comment.score);
  footer.append(score ? `${score}, on ` : 'On ', linkIfReddit(createElement('a', '', comment.post.title || '(untitled post)'), comment.post.url));
  item.append(footer);
  return item;
};

// Page numbers to show: first, last, and the current page's neighbours, with gaps marked null
const visiblePages = (currentPage, count) => {
  const pages = [...new Set([1, currentPage - 1, currentPage, currentPage + 1, count])]
    .filter(page => page >= 1 && page <= count)
    .sort((a, b) => a - b);
  const withGaps = [];
  for (const [index, page] of pages.entries()) {
    if (index > 0 && page - pages[index - 1] > 1) {
      withGaps.push(null);
    }
    withGaps.push(page);
  }
  return withGaps;
};

const pageItem = (label, page, {active = false, disabled = false, ariaLabel = ''} = {}) => {
  const item = createElement('li', `page-item${active ? ' active' : ''}${disabled ? ' disabled' : ''}`);
  const button = createElement('button', 'page-link', label);
  button.type = 'button';
  button.disabled = disabled;
  if (ariaLabel) {
    button.setAttribute('aria-label', ariaLabel);
  }
  if (active) {
    button.setAttribute('aria-current', 'page');
  }
  button.addEventListener('click', () => {
    postsState.page = page;
    renderPosts();
  });
  item.append(button);
  return item;
};

const renderPagination = pageCount => {
  if (pageCount <= 1) {
    postsPagination.replaceChildren();
    return;
  }
  const {page} = postsState;
  const pageItems = [pageItem('‹', page - 1, {disabled: page === 1, ariaLabel: 'Previous page'})];
  for (const number of visiblePages(page, pageCount)) {
    if (number === null) {
      const gap = createElement('li', 'page-item disabled');
      gap.append(createElement('span', 'page-link', '…'));
      pageItems.push(gap);
    } else {
      pageItems.push(pageItem(String(number), number, {active: number === page, ariaLabel: `Page ${number}`}));
    }
  }
  pageItems.push(pageItem('›', page + 1, {disabled: page === pageCount, ariaLabel: 'Next page'}));
  postsPagination.replaceChildren(...pageItems);
};

// Items in range that pass the filters (posts are filtered by the labels they show)
const listMatches = () => {
  const who = postsWhoSelect.value;
  const what = postsWhatSelect.value;
  const onlyDisagreements = postsDisagree.checked && !isComments();
  return postsState.inRange.filter(item => {
    const itemWho = isComments() ? item.who : shownWho(item);
    const itemWhat = isComments() ? item.what : shownWhat(item);
    return (!who || itemWho === who) && (!what || itemWhat.includes(what)) && (!onlyDisagreements || disagrees(item));
  });
};

function renderPosts() {
  const word = itemWord();
  const matches = listMatches();
  const pageCount = Math.max(1, Math.ceil(matches.length / POSTS_PER_PAGE));
  postsState.page = Math.min(Math.max(postsState.page, 1), pageCount);

  const start = (postsState.page - 1) * POSTS_PER_PAGE;
  const pageMatches = matches.slice(start, start + POSTS_PER_PAGE);
  postsList.replaceChildren(...(pageMatches.length > 0 ?
    pageMatches.map(item => (isComments() ? commentItem(item) : postItem(item))) :
    [createElement('li', 'list-group-item py-4 text-center text-body-secondary', `No ${word}s match these filters in this date range.`)]));

  postsPageInfo.textContent = matches.length > 0 ?
    `Showing ${start + 1} to ${start + pageMatches.length} of ${pluralize(matches.length, word)}` :
    '';
  renderPagination(pageCount);
}

for (const select of [postsWhoSelect, postsWhatSelect, postsDisagree]) {
  select.addEventListener('change', () => {
    postsState.page = 1;
    renderPosts();
  });
}

const updatePostsList = (list, from, to) => {
  postsState.inRange = [...list].reverse(); // newest first
  postsState.page = 1;
  postsSummary.textContent = `${formatRange(from, to)}, newest first`;
  renderPosts();
};

const mainChartSubtitle = document.getElementById('main-chart-subtitle');
const mainRange = createDateRange('main-chart', (from, to) => {
  const list = items();
  const word = itemWord();
  const {labels, counts} = countPostsPerMonth(list, from, to);
  const total = counts.reduce((sum, count) => sum + count, 0);
  mainChart.data.labels = labels;
  mainChart.data.datasets[0].label = isComments() ? 'Comments' : 'Posts';
  mainChart.data.datasets[0].data = counts;
  // With only a month or two there's no line to speak of, so show the points
  mainChart.data.datasets[0].pointRadius = counts.length < 3 ? 4 : 0;
  mainChart.update();
  mainChartSubtitle.textContent = `${current.display_name}, ${formatRange(from, to)}, ${pluralize(total, word)}`;

  const inRange = list.filter(item => item.time >= from && item.time <= to);
  updateBreakdowns(inRange, from, to);
  updatePostsList(inRange, from, to);
});

// Comments view for a community without comment data: every section says so
const showCommentsNotAvailable = () => {
  for (const key of ['main', 'who', 'what']) {
    setAvailable(key, false);
  }
  mainChartSubtitle.textContent = current.display_name;
  breakdownSubtitle.textContent = '';
  postsSummary.textContent = '';
  postsPageInfo.textContent = '';
  postsPagination.replaceChildren();
  postsList.replaceChildren(createElement('li', 'list-group-item py-4 text-body-secondary', NOT_AVAILABLE));
};

// ---------------------------------------------------------------------------
// Predictions chart: hand (actual) vs. model (predicted) post type counts for the posts the
// model labeled (data/subreddits/<name>/predictions.csv, built by scripts/build_predictions_data.py)
// ---------------------------------------------------------------------------
const predictionsSubtitle = document.getElementById('predictions-chart-subtitle');
const predictionsControls = document.getElementById('predictions-controls');
const predictionsContent = document.getElementById('predictions-content');
const predictionsEmpty = document.getElementById('predictions-empty');

const predictionsChart = new Chart(document.getElementById('predictions-chart'), {
  type: 'bar',
  data: {
    labels: [],
    datasets: [{
      label: 'Actual',
      backgroundColor: coreui.Utils.getStyle('--cui-primary'),
      data: []
    }, {
      label: 'Predicted',
      backgroundColor: coreui.Utils.getStyle('--cui-info'),
      data: []
    }]
  },
  options: {
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        align: 'end',
        labels: {
          color: coreui.Utils.getStyle('--cui-body-color'),
          boxWidth: 12
        }
      }
    },
    scales: {
      x: {
        grid: {
          display: false
        },
        ticks: {
          color: coreui.Utils.getStyle('--cui-body-color')
        }
      },
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: 'Posts',
          color: coreui.Utils.getStyle('--cui-body-color')
        },
        border: {
          color: coreui.Utils.getStyle('--cui-border-color-translucent')
        },
        grid: {
          color: coreui.Utils.getStyle('--cui-border-color-translucent')
        },
        ticks: {
          color: coreui.Utils.getStyle('--cui-body-color'),
          precision: 0
        }
      }
    }
  }
});

let predictionsRange = null;

// Posts the selected model gave a post type, and how its predictions were made
const predictedPosts = () => current.posts.filter(post => modelLabelFor(post)?.what);
const splitWord = posts => (posts.every(post => modelLabelFor(post).split === 'test') ? 'test post' : 'post');

const updatePredictionsChart = () => {
  if (!predictionsRange || !selectedModel) {
    return;
  }
  const [from, to] = predictionsRange;
  const allPredicted = predictedPosts();
  const pairs = allPredicted
    .filter(post => post.time >= from && post.time <= to)
    .map(post => {
      const predicted = modelLabelFor(post).what;
      return {actual: handWhatFor(post, predicted), predicted};
    });
  // Categories that appear in this model's hand or model labels, in the usual order
  const present = new Set(allPredicted.flatMap(post => [...post.what, modelLabelFor(post).what]));
  const categories = current.labelWhatOrder.filter(category => present.has(category));
  const correct = pairs.filter(pair => pair.actual === pair.predicted).length;

  predictionsChart.data.labels = categories;
  predictionsChart.data.datasets[0].data = categories.map(category => pairs.filter(pair => pair.actual === category).length);
  predictionsChart.data.datasets[1].label = `Predicted (${selectedModel})`;
  predictionsChart.data.datasets[1].data = categories.map(category => pairs.filter(pair => pair.predicted === category).length);
  predictionsChart.update();

  // Range and post count on one line, the model's accuracy on its own line
  const accuracy = pairs.length === 0 ?
    'No labeled posts in this range' :
    `${selectedModel}: ${correct} of ${pairs.length} correct (${Math.round((100 * correct) / pairs.length)}%)`;
  predictionsSubtitle.replaceChildren(
    createElement('div', '', `${current.display_name}, ${formatRange(from, to)}, ${pluralize(pairs.length, splitWord(allPredicted))}`),
    createElement('div', '', accuracy)
  );
};

const predictionsDateRange = createDateRange('predictions-chart', (from, to) => {
  predictionsRange = [from, to];
  updatePredictionsChart();
});

// Predictions are for posts only; keepValues keeps the chosen dates (toggles and model changes)
const updatePredictionsSection = ({keepValues = false} = {}) => {
  const community = current;
  const hasPredictions = !isComments() && Boolean(selectedModel) && modelHas('what');
  predictionsControls.classList.toggle('d-none', !hasPredictions);
  predictionsContent.classList.toggle('d-none', !hasPredictions);
  predictionsEmpty.classList.toggle('d-none', hasPredictions);
  if (!hasPredictions) {
    predictionsEmpty.textContent = isComments() ? NOT_AVAILABLE : NOT_AVAILABLE_YET;
    predictionsSubtitle.textContent = community.display_name;
    return;
  }
  predictionsDateRange.setBounds(community.range, {keepValues});
};

// ---------------------------------------------------------------------------
// Agreement (sidebar: Hand vs. Model): how often the selected model matches the hand labels,
// over every post that has both. Post type and poster type are scored separately.
// ---------------------------------------------------------------------------
const agreementSubtitle = document.getElementById('agreement-subtitle');
const agreementContent = document.getElementById('agreement-content');

const splitText = posts => {
  const oof = posts.filter(post => modelLabelFor(post).split === 'oof').length;
  if (oof === posts.length) {
    return 'out-of-fold (cross-validated) predictions';
  }
  return oof === 0 ? 'test-set predictions only' : `${oof} out-of-fold and ${posts.length - oof} test-set predictions`;
};

// Landis and Koch's wording for kappa values
const kappaWord = kappa => {
  if (kappa < 0) {
    return 'worse than chance';
  }
  return ['slight', 'fair', 'moderate', 'substantial', 'almost perfect'][Math.min(4, Math.floor(kappa / 0.2))];
};
const formatShare = (part, whole) => (whole === 0 ? 'n/a' : formatPercent(part / whole));

const simpleTable = (headers, rows, className = 'table table-sm mb-0') => {
  const table = createElement('table', className);
  const headRow = createElement('tr');
  headRow.append(...headers.map(([text, cls]) => {
    const th = createElement('th', cls ?? '', text);
    th.scope = 'col';
    return th;
  }));
  const thead = createElement('thead');
  thead.append(headRow);
  const tbody = createElement('tbody');
  tbody.append(...rows);
  table.append(thead, tbody);
  const wrapper = createElement('div', 'table-responsive');
  wrapper.append(table);
  return wrapper;
};

const agreementBlock = (field, title) => {
  const block = createElement('div', 'mb-4');
  block.append(createElement('h5', 'mb-1', title));
  // [hand, model] for each post with both labels for this field
  const pairs = current.posts
    .map(post => ({post, label: modelLabelFor(post)}))
    .filter(({post, label}) => label?.[field] && (field === 'who' ? post.who : post.what.length > 0))
    .map(({post, label}) => ({post, hand: field === 'who' ? post.who : handWhatFor(post, label.what), model: label[field]}));
  if (pairs.length === 0) {
    block.append(createElement('p', 'text-body-secondary mb-0', NOT_AVAILABLE_YET));
    return block;
  }

  const n = pairs.length;
  const agree = pairs.filter(pair => pair.hand === pair.model).length;
  const order = field === 'who' ? current.labelWhoOrder : current.labelWhatOrder;
  const categories = order.filter(category => pairs.some(pair => pair.hand === category || pair.model === category));
  const handCount = category => pairs.filter(pair => pair.hand === category).length;
  const modelCount = category => pairs.filter(pair => pair.model === category).length;
  const both = (hand, model) => pairs.filter(pair => pair.hand === hand && pair.model === model).length;

  // Cohen's kappa: agreement beyond what the two label distributions would give by chance
  const observed = agree / n;
  const expected = categories.reduce((sum, category) => sum + ((handCount(category) / n) * (modelCount(category) / n)), 0);
  const kappa = expected === 1 ? null : (observed - expected) / (1 - expected);

  block.append(createElement('div', 'small text-body-secondary mb-3',
    `Based on ${pluralize(n, 'post')} with both a hand label and a ${selectedModel} label (${splitText(pairs.map(pair => pair.post))}).`));

  const metrics = createElement('div', 'row g-3 mb-3');
  for (const [label, value, note] of [
    ['Agreement', formatPercent(observed), `${agree} of ${n} posts`],
    ['Cohen\'s kappa', kappa === null ? 'n/a' : kappa.toFixed(2), kappa === null ? '' : `${kappaWord(kappa)} agreement`]
  ]) {
    const col = createElement('div', 'col-auto me-4');
    col.append(createElement('div', 'text-body-secondary small', label), createElement('div', 'fs-4 fw-semibold', value), createElement('div', 'small text-body-secondary', note));
    metrics.append(col);
  }
  block.append(metrics);

  // Precision and recall per category, treating the hand label as correct
  const scoreRows = categories.map(category => {
    const tr = createElement('tr');
    const th = createElement('th', 'fw-normal', category);
    th.scope = 'row';
    const hit = both(category, category);
    tr.append(th,
      createElement('td', 'text-end', String(handCount(category))),
      createElement('td', 'text-end', String(modelCount(category))),
      createElement('td', 'text-end', formatShare(hit, modelCount(category))),
      createElement('td', 'text-end', formatShare(hit, handCount(category))));
    return tr;
  });
  const row = createElement('div', 'row g-4');
  const left = createElement('div', 'col-xl-5');
  left.append(
    createElement('h6', 'text-body-secondary', 'Precision and Recall'),
    simpleTable([['Category'], ['Hand', 'text-end'], ['Model', 'text-end'], ['Precision', 'text-end'], ['Recall', 'text-end']], scoreRows),
    createElement('div', 'small text-body-secondary mt-2', 'Precision: share of the model\'s labels for a category that match the hand label. Recall: share of hand-labeled posts in a category that the model found.')
  );

  // Confusion matrix: rows are hand labels, columns model labels, shaded by share of the row
  const matrixRows = categories.map(hand => {
    const tr = createElement('tr');
    const th = createElement('th', 'fw-normal text-start', hand);
    th.scope = 'row';
    tr.append(th);
    const rowTotal = handCount(hand);
    for (const model of categories) {
      const count = both(hand, model);
      const share = rowTotal === 0 ? 0 : count / rowTotal;
      const td = createElement('td', hand === model ? 'fw-semibold' : '', String(count));
      td.style.backgroundColor = `rgba(var(--cui-primary-rgb), ${(share * 0.85).toFixed(3)})`;
      td.style.color = share > 0.5 ? '#fff' : '';
      td.title = `Hand: ${hand}, model: ${model}, ${count} of ${pluralize(rowTotal, 'post')}`;
      tr.append(td);
    }
    return tr;
  });
  const right = createElement('div', 'col-xl-7');
  right.append(
    createElement('h6', 'text-body-secondary', 'Confusion Matrix'),
    simpleTable([['Hand \\ Model', 'text-start'], ...categories.map(category => [category])], matrixRows, 'table table-sm table-bordered text-center mb-0'),
    createElement('div', 'small text-body-secondary mt-2', 'Rows: hand label. Columns: model label. Darker cells hold a larger share of the row.')
  );
  row.append(left, right);
  block.append(row);
  return block;
};

const updateAgreement = () => {
  agreementSubtitle.textContent = current.display_name;
  if (isComments() || !selectedModel) {
    setAvailable('agreement', false, isComments() ? NOT_AVAILABLE : NOT_AVAILABLE_YET);
    return;
  }
  setAvailable('agreement', true);
  agreementSubtitle.textContent = `${current.display_name}, hand labels vs. ${selectedModel}`;
  agreementContent.replaceChildren(agreementBlock('what', 'Post Type'), agreementBlock('who', 'Poster Type'));
  agreementContent.lastChild.classList.replace('mb-4', 'mb-0');
};

// ---------------------------------------------------------------------------
// Post Map: one point per post from data/subreddits/<name>/post_map.csv (nearby posts have
// similar text). Clicking a point shows that post in the list.
// ---------------------------------------------------------------------------
const MAP_METHODS = {'tfidf-tsne': 'TF-IDF + t-SNE (temporary)', 'sbert-umap': 'SBERT + UMAP'};
const EXCERPT_LENGTH = 120;
const mapColorSelect = document.getElementById('post-map-color');
const mapUnknown = document.getElementById('post-map-unknown');
const mapSubtitle = document.getElementById('post-map-subtitle');
const mapNote = document.getElementById('post-map-note');

const hexToRgba = (hex, alpha) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};
const excerpt = post => {
  const text = [post.title, post.snippet].filter(Boolean).join('. ').replace(/\s+/g, ' ').trim();
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…` : text;
};

const mapChart = new Chart(document.getElementById('post-map-chart'), {
  type: 'scatter',
  data: {
    datasets: []
  },
  options: {
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        align: 'end',
        labels: {
          color: coreui.Utils.getStyle('--cui-body-color'),
          boxWidth: 10,
          usePointStyle: true
        }
      },
      tooltip: {
        mode: 'nearest',
        intersect: true,
        callbacks: {
          // CoreUI's tooltip shows one body line per point, so the date and labels go in the title rows
          title: items => {
            const post = items[0]?.raw.post;
            if (!post) {
              return [];
            }
            const lines = [formatDate(post.time, SHORT_DATE), `Hand: ${[post.who, ...post.what].join(', ')}`];
            const label = modelLabelFor(post);
            if (label) {
              lines.push(`${selectedModel}: ${[label.who, label.what].filter(Boolean).join(', ')}`);
            }
            const point = current.mapPoints.get(post.id);
            if (point?.topic !== null && point?.topic !== undefined) {
              lines.push(point.topic === -1 ? 'Topic: outlier' : `Topic ${point.topic}`);
            }
            return lines;
          },
          label: context => excerpt(context.raw.post)
        }
      }
    },
    scales: {
      x: {
        display: false
      },
      y: {
        display: false
      }
    },
    onClick: (event, elements) => {
      if (elements.length > 0) {
        const {datasetIndex, index} = elements[0];
        goToPost(mapChart.data.datasets[datasetIndex].data[index].post);
      }
    },
    onHover: (event, elements) => {
      event.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
    }
  }
});

// Category (legend entry) of a post for each "Color by" choice, with the legend order and colors
const mapColoring = colorBy => {
  if (colorBy === 'model') {
    return {
      categoryOf: post => modelLabelFor(post)?.what ?? 'No model label',
      order: [...current.labelWhatOrder, 'No model label'],
      colorOf: category => current.whatColors.get(category) ?? NEUTRAL_COLOR
    };
  }
  if (colorBy === 'who') {
    return {categoryOf: post => post.who, order: current.labelWhoOrder, colorOf: category => current.whoColors.get(category) ?? NEUTRAL_COLOR};
  }
  if (colorBy === 'topic') {
    const topicName = topic => (topic === null ? 'No topic' : (topic === -1 ? 'Outliers' : `Topic ${topic}`));
    const topics = unique([...current.mapPoints.values()].map(point => point.topic)).sort((a, b) => (a ?? 1e9) - (b ?? 1e9));
    const colors = new Map();
    let slot = 0;
    for (const topic of topics) {
      colors.set(topicName(topic), topic === null || topic === -1 ? NEUTRAL_COLOR : CATEGORY_COLORS[slot++ % CATEGORY_COLORS.length]);
    }
    return {categoryOf: post => topicName(current.mapPoints.get(post.id).topic), order: topics.map(topicName), colorOf: category => colors.get(category)};
  }
  // Hand post type (a post with several counts under its first one)
  return {
    categoryOf: post => post.what[0] ?? 'No label',
    order: [...current.labelWhatOrder, 'No label'],
    colorOf: category => current.whatColors.get(category) ?? NEUTRAL_COLOR
  };
};

const updatePostMap = () => {
  mapSubtitle.textContent = current.display_name;
  if (isComments() || current.mapPoints.size === 0) {
    setAvailable('map', false, isComments() ? NOT_AVAILABLE : NOT_AVAILABLE_YET);
    return;
  }
  setAvailable('map', true);

  // Options without data stay listed but disabled
  const hasTopics = [...current.mapPoints.values()].some(point => point.topic !== null);
  const modelOption = mapColorSelect.querySelector('option[value="model"]');
  modelOption.disabled = !selectedModel || !modelHas('what');
  modelOption.textContent = selectedModel ? `Model label (${selectedModel})` : 'Model label';
  mapColorSelect.querySelector('option[value="topic"]').disabled = !hasTopics;
  if (mapColorSelect.selectedOptions[0]?.disabled) {
    mapColorSelect.value = 'hand';
  }

  const points = current.posts
    .filter(post => current.mapPoints.has(post.id))
    .map(post => ({x: current.mapPoints.get(post.id).x, y: current.mapPoints.get(post.id).y, post}));
  const {categoryOf, order, colorOf} = mapColoring(mapColorSelect.value);
  const highlight = mapUnknown.checked;
  const isHighlighted = post => highlight && post.who === 'Unknown';

  const datasets = order.map(category => ({
    label: category,
    data: points.filter(point => categoryOf(point.post) === category && !isHighlighted(point.post)),
    backgroundColor: hexToRgba(colorOf(category), highlight ? 0.2 : 0.75),
    borderColor: 'transparent',
    pointRadius: 3,
    pointHoverRadius: 5,
    order: 1
  })).filter(dataset => dataset.data.length > 0);
  if (highlight) {
    const unknown = points.filter(point => isHighlighted(point.post));
    // Drawn on top (lower order) with a dark outline
    datasets.push({
      label: `Unknown poster type (${unknown.length})`,
      data: unknown,
      backgroundColor: unknown.map(point => colorOf(categoryOf(point.post))),
      borderColor: coreui.Utils.getStyle('--cui-body-color'),
      borderWidth: 1.5,
      pointRadius: 5,
      pointHoverRadius: 7,
      order: 0
    });
  }
  mapChart.data.datasets = datasets;
  mapChart.update();

  mapSubtitle.textContent = `${current.display_name}, ${points.length} of ${pluralize(current.posts.length, 'post')} placed`;
  const method = MAP_METHODS[current.mapMethod] ?? (current.mapMethod || 'unknown method');
  mapNote.textContent = `Layout: ${method}. Nearby points have similar text; the axes have no units. Click a point to see the post in the list.`;
};

for (const control of [mapColorSelect, mapUnknown]) {
  control.addEventListener('change', () => current && updatePostMap());
}

// Shows a post in the list: widens the date range and clears filters if they hide it, then
// opens its page and scrolls to it
const goToPost = post => {
  if (isComments()) {
    return;
  }
  if (!postsState.inRange.includes(post)) {
    mainRange.reset();
  }
  if (!listMatches().includes(post)) {
    postsWhoSelect.value = '';
    postsWhatSelect.value = '';
    postsDisagree.checked = false;
  }
  const index = listMatches().indexOf(post);
  if (index < 0) {
    return;
  }
  postsState.page = Math.floor(index / POSTS_PER_PAGE) + 1;
  renderPosts();
  const element = document.getElementById(`post-${post.id}`);
  if (!element) {
    return;
  }
  const smooth = window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
  element.scrollIntoView({behavior: smooth ? 'smooth' : 'auto', block: 'center'});
  element.querySelector('a')?.focus({preventScroll: true});
  element.classList.add('list-group-item-primary');
  setTimeout(() => element.classList.remove('list-group-item-primary'), 2500);
};

// ---------------------------------------------------------------------------
// Compare Communities: the stat cards' numbers as percentages, one column per community
// ---------------------------------------------------------------------------
const compareContent = document.getElementById('compare-content');

const renderCompare = communities => {
  if (communities.length < 2) {
    compareContent.replaceChildren(createElement('p', 'text-body-secondary mb-0', 'More communities will be added.'));
    return;
  }

  const allPosts = communities.reduce((sum, community) => sum + community.posts.length, 0);
  const withComments = communities.filter(hasCommentData);
  const allComments = withComments.reduce((sum, community) => sum + totalComments(community), 0);
  const shareOf = (community, test) => community.posts.filter(test).length / community.posts.length;

  const sections = [{
    title: 'Overview',
    rows: [
      ['Share of all posts', community => formatPercent(community.posts.length / allPosts)],
      ['Share of all comments', community => (hasCommentData(community) && allComments > 0 ? formatPercent(totalComments(community) / allComments) : 'n/a')],
      ['Patient posters', community => formatPercent(patientShare(community.posts))],
      ['Posts in busiest year', community => {
        const busiest = busiestYear(community);
        return `${formatPercent(busiest.count / community.posts.length)} (${busiest.year})`;
      }]
    ]
  }, {
    title: 'Poster Type',
    rows: unique(communities.flatMap(community => community.whoOrder))
      .map(name => [name, community => formatPercent(shareOf(community, post => post.who === name))])
  }, {
    title: 'Post Type',
    rows: unique(communities.flatMap(community => community.whatOrder))
      .map(name => [name, community => formatPercent(shareOf(community, post => post.what.includes(name)))])
  }];

  const table = createElement('table', 'table table-sm mb-0');
  const headRow = createElement('tr');
  headRow.append(createElement('th', '', ''));
  for (const community of communities) {
    const th = createElement('th', 'text-end', community.display_name);
    th.scope = 'col';
    th.append(createElement('div', 'small fw-normal text-body-secondary', pluralize(community.posts.length, 'post')));
    headRow.append(th);
  }
  const thead = createElement('thead');
  thead.append(headRow);
  table.append(thead);

  for (const section of sections) {
    const tbody = createElement('tbody');
    const titleRow = createElement('tr');
    const titleCell = createElement('th', 'text-body-secondary pt-3', section.title);
    titleCell.colSpan = communities.length + 1;
    titleCell.scope = 'colgroup';
    titleRow.append(titleCell);
    tbody.append(titleRow);
    for (const [label, value] of section.rows) {
      const tr = createElement('tr');
      const th = createElement('th', 'fw-normal', label);
      th.scope = 'row';
      tr.append(th, ...communities.map(community => createElement('td', 'text-end', value(community))));
      tbody.append(tr);
    }
    table.append(tbody);
  }

  const wrapper = createElement('div', 'table-responsive');
  wrapper.append(table);
  compareContent.replaceChildren(wrapper, createElement('div', 'small text-body-secondary mt-2', 'A post can have more than one post type, so those rows can add up to more than 100%.'));
};

// ---------------------------------------------------------------------------
// Header: community dropdown and subtitle
// ---------------------------------------------------------------------------
const subredditSelect = document.getElementById('subreddit-select');
const loadError = document.getElementById('load-error');
const loaded = new Map(); // name → community data

const showLoadErrors = messages => {
  loadError.replaceChildren(...messages.map(message => createElement('div', '', message)));
  loadError.classList.toggle('d-none', messages.length === 0);
};

// Redraws everything for the current community and mode. keepValues keeps the chosen date
// ranges (used when only the Posts | Comments toggle changed).
// Model dropdowns (header, Actual vs. Predicted, Agreement) all show the same model. The header
// one only shows in the Model view; Hand | Model is for posts, so it's disabled for comments.
const modelSelects = [...document.querySelectorAll('.model-select')];
const labelRadios = [...document.querySelectorAll('input[name="label-source"]')];
const updateModelControls = () => {
  for (const select of modelSelects) {
    select.replaceChildren(...current.models.map(model => new Option(model, model)));
    select.value = selectedModel ?? '';
    select.disabled = current.models.length === 0;
  }
  document.getElementById('header-model').classList.toggle('d-none', !useModel() || current.models.length === 0);
  for (const radio of labelRadios) {
    radio.disabled = isComments();
  }
};

const render = ({keepValues = false} = {}) => {
  applyModeText();
  updateModelControls();
  updateStatCards();
  postsState.expanded.clear();
  updateFilters();
  if (items()) {
    setAvailable('main', true);
    mainRange.setBounds(modeRange(), {keepValues});
  } else {
    showCommentsNotAvailable();
  }
  updatePredictionsSection({keepValues});
  updateAgreement();
  updatePostMap();
};

const showSubreddit = name => {
  current = loaded.get(name);
  // Keep the chosen model if this community has it too
  selectedModel = current.models.includes(selectedModel) ? selectedModel : current.models[0] ?? null;
  render();
};

subredditSelect.addEventListener('change', () => showSubreddit(subredditSelect.value));

for (const select of modelSelects) {
  select.addEventListener('change', () => {
    selectedModel = select.value;
    render({keepValues: true});
  });
}

for (const radio of labelRadios) {
  radio.addEventListener('change', () => {
    labelSource = radio.value;
    if (current) {
      render({keepValues: true});
    }
  });
}

for (const radio of document.querySelectorAll('input[name="view-mode"]')) {
  radio.addEventListener('change', () => {
    mode = radio.value;
    if (current) {
      render({keepValues: true});
    }
  });
}

const init = async () => {
  let subreddits;
  try {
    subreddits = await fetchJSON('data/subreddits.json');
  } catch (error) {
    showLoadErrors([`${error.message}. Serve the dashboard with "python3 -m http.server" instead of opening the file directly.`]);
    subredditSelect.replaceChildren(new Option('No data'));
    return;
  }

  const ready = subreddits.filter(subreddit => subreddit.ready);
  const results = await Promise.allSettled(ready.map(subreddit => loadSubreddit(subreddit)));
  const errors = [];
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      loaded.set(result.value.name, result.value);
    } else {
      errors.push(`${ready[index].display_name}: ${result.reason.message}`);
    }
  }
  showLoadErrors(errors);

  // Communities without data (not ready yet, or failed to load) stay listed but can't be picked
  subredditSelect.replaceChildren(...subreddits.map(subreddit => {
    const isLoaded = loaded.has(subreddit.name);
    let label = subreddit.display_name;
    if (!subreddit.ready) {
      label += ' (coming soon)';
    } else if (!isLoaded) {
      label += ' (could not load)';
    }
    const option = new Option(label, subreddit.name);
    option.disabled = !isLoaded;
    return option;
  }));

  const communities = [...loaded.values()];
  renderCompare(communities);
  if (communities.length === 0) {
    return;
  }

  const start = Math.min(...communities.map(community => community.start));
  const end = Math.max(...communities.map(community => community.end));
  document.getElementById('page-subtitle').textContent =
    `Reddit posts from rare-disease communities, ${formatDate(start, MONTH_YEAR)} to ${formatDate(end, MONTH_YEAR)}`;

  subredditSelect.disabled = false;
  subredditSelect.value = communities[0].name;
  // The browser may restore the toggle after a reload, so start from whichever button is checked
  mode = document.querySelector('input[name="view-mode"]:checked')?.value ?? 'posts';
  labelSource = document.querySelector('input[name="label-source"]:checked')?.value ?? 'hand';
  showSubreddit(communities[0].name);
  highlightCurrentSection();
};

// ---------------------------------------------------------------------------
// Sidebar jump links: highlight the section in view
// ---------------------------------------------------------------------------
const sectionLinks = [...document.querySelectorAll('[data-section-link]')];
const sectionTargets = sectionLinks.map(link => document.querySelector(link.getAttribute('href')));

function highlightCurrentSection() {
  // The current section is the last one whose top has scrolled past a line just below where the
  // jump links leave a section (or the last section, once the page is scrolled to the bottom).
  const CURRENT_LINE = 160; // px from the top of the window; sections land just below the sticky header
  const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
  let currentIndex = 0;
  for (const [index, target] of sectionTargets.entries()) {
    if (target.getBoundingClientRect().top <= CURRENT_LINE) {
      currentIndex = index;
    }
  }
  if (atBottom) {
    currentIndex = sectionTargets.length - 1;
  }
  for (const [index, link] of sectionLinks.entries()) {
    link.classList.toggle('is-current', index === currentIndex);
    if (index === currentIndex) {
      link.setAttribute('aria-current', 'location');
    } else {
      link.removeAttribute('aria-current');
    }
  }
}

window.addEventListener('scroll', highlightCurrentSection, {passive: true});
window.addEventListener('resize', highlightCurrentSection);
highlightCurrentSection();

// On small screens the sidebar covers the page, so close it after jumping to a section
for (const link of sectionLinks) {
  link.addEventListener('click', () => {
    if (window.matchMedia('(max-width: 991.98px)').matches) {
      coreui.Sidebar.getInstance(document.querySelector('#sidebar'))?.hide();
    }
  });
}

init();
