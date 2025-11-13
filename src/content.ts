import { getEncoding } from "js-tiktoken";

const KEY = "egbertw_token_encoder";
type EncoderName = "o200k_base" | "cl100k_base";

let currentEnc: EncoderName =
  (localStorage.getItem(KEY) as EncoderName) || "o200k_base";

const encoders = new Map<EncoderName, ReturnType<typeof getEncoding>>();

function getEncoder(name: EncoderName) {
  if (!encoders.has(name)) {
    encoders.set(name, getEncoding(name));
  }
  return encoders.get(name)!;
}

// ---------- 只读：抓页面对话文本 ----------
function getTextsFromPage(): string[] {
  const nodes = document.querySelectorAll(
    "[data-message-author-role] .markdown, " +
      "[data-message-author-role] .prose, " +
      "[data-message-author-role]"
  );
  return Array.from(nodes)
    .map((n) => (n.textContent || "").trim())
    .filter(Boolean);
}

// ---------- 顶部按钮 + Radix 风格菜单 ----------
let mounted = false;
let buttonEl: HTMLButtonElement | null = null;
let labelSpan: HTMLSpanElement | null = null;

// 菜单相关节点
let popperWrapper: HTMLDivElement | null = null;
let menuContent: HTMLDivElement | null = null;
let charsItem: HTMLDivElement | null = null;
let turnsItem: HTMLDivElement | null = null;
let encoderItem: HTMLDivElement | null = null;
let switchItem: HTMLDivElement | null = null;

function createMenuDom() {
  if (popperWrapper) return;

  // 外层 wrapper：position fixed + data-radix-popper-content-wrapper
  popperWrapper = document.createElement("div");
  popperWrapper.setAttribute("data-radix-popper-content-wrapper", "");
  popperWrapper.dir = "ltr";
  popperWrapper.style.position = "fixed";
  popperWrapper.style.left = "0px";
  popperWrapper.style.top = "0px";
  popperWrapper.style.transform = "translate(0px, 0px)";
  popperWrapper.style.minWidth = "max-content";
  popperWrapper.style.zIndex = "50";
  popperWrapper.style.willChange = "transform";
  popperWrapper.style.display = "none";

  // 内层菜单 content：仿你给的 class，并统一文字样式为 text-sm
  menuContent = document.createElement("div");
  menuContent.setAttribute("data-side", "bottom");
  menuContent.setAttribute("data-align", "end");
  menuContent.setAttribute("role", "menu");
  menuContent.setAttribute("aria-orientation", "vertical");
  menuContent.setAttribute("data-radix-menu-content", "");
  menuContent.dir = "ltr";
  menuContent.tabIndex = -1;
  menuContent.dataset.state = "open";
  menuContent.className =
    "z-50 max-w-xs rounded-2xl popover bg-token-main-surface-primary " +
    "dark:bg-[#353535] shadow-long will-change-[opacity,transform] " +
    "radix-side-bottom:animate-slideUpAndFade radix-side-left:animate-slideRightAndFade " +
    "radix-side-right:animate-slideLeftAndFade radix-side-top:animate-slideDownAndFade " +
    "py-1.5 data-[unbound-width]:min-w-[unset] data-[custom-padding]:py-0 " +
    "[--trigger-width:calc(var(--radix-dropdown-menu-trigger-width)-2*var(--radix-align-offset))] " +
    "min-w-(--trigger-width) max-h-[var(--radix-dropdown-menu-content-available-height)] " +
    "overflow-y-auto select-none text-sm";

  const makeItem = (): HTMLDivElement => {
    const item = document.createElement("div");
    item.role = "menuitem";
    item.tabIndex = 0;
    item.dataset.orientation = "vertical";
    item.setAttribute("data-radix-collection-item", "");
    item.className =
      "group __menu-item gap-1.5 px-4 py-1.5 text-token-text-primary " +
      "hover:bg-token-main-surface-secondary cursor-default";
    return item;
  };

  charsItem = makeItem();
  charsItem.textContent = "Chars: 0";

  turnsItem = makeItem();
  turnsItem.textContent = "Turns: 0";

  encoderItem = makeItem();
  encoderItem.textContent = `Encoder: ${currentEnc}`;

  const sep = document.createElement("div");
  sep.role = "separator";
  sep.className =
    "bg-token-border-default h-px mx-4 my-1 first:hidden last:hidden";

  switchItem = makeItem();
  switchItem.textContent = "Switch encoder";
  switchItem.dataset.color = "danger";
  switchItem.className +=
    " text-token-text-secondary hover:text-token-text-primary";

  switchItem.addEventListener("click", (ev) => {
    ev.stopPropagation();
    currentEnc = currentEnc === "o200k_base" ? "cl100k_base" : "o200k_base";
    localStorage.setItem(KEY, currentEnc);
    lastRun = 0;
    scheduleCompute(0);
    if (encoderItem) encoderItem.textContent = `Encoder: ${currentEnc}`;
    closeMenu();
  });

  menuContent.appendChild(charsItem);
  menuContent.appendChild(turnsItem);
  menuContent.appendChild(encoderItem);
  menuContent.appendChild(sep);
  menuContent.appendChild(switchItem);

  popperWrapper.appendChild(menuContent);
  document.body.appendChild(popperWrapper);
}

function openMenu() {
  if (!buttonEl || !popperWrapper || !menuContent) return;

  // 先显示，让浏览器计算宽度
  popperWrapper.style.display = "block";

  const btnRect = buttonEl.getBoundingClientRect();
  const menuRect = menuContent.getBoundingClientRect();

  // 默认：左对齐按钮
  let x = btnRect.left;
  const y = btnRect.bottom + 4;

  const vw = window.innerWidth;
  const margin = 8;

  // 如果右侧会超出屏幕，往左挪
  if (x + menuRect.width + margin > vw) {
    x = Math.max(margin, vw - menuRect.width - margin);
  }

  popperWrapper.style.left = "0px";
  popperWrapper.style.top = "0px";
  popperWrapper.style.transform = `translate(${x}px, ${y}px)`;
}

function closeMenu() {
  if (popperWrapper) {
    popperWrapper.style.display = "none";
  }
}

function toggleMenu() {
  if (!popperWrapper) return;
  if (popperWrapper.style.display === "block") {
    closeMenu();
  } else {
    openMenu();
  }
}

function ensureUiMounted() {
  if (mounted) return;

  const bar = document.querySelector<HTMLElement>("#conversation-header-actions");
  if (!bar) return;

  const wrapper = document.createElement("div");
  wrapper.className = "flex items-center";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className =
    "btn relative btn-ghost text-token-text-primary mx-2 flex items-center gap-1";

  const label = document.createElement("span");
  label.textContent = "0.0k tokens";
  labelSpan = label;

  const chevron = document.createElement("span");
  chevron.textContent = "▾";
  chevron.style.fontSize = "10px";

  btn.appendChild(label);
//   btn.appendChild(chevron);
  buttonEl = btn;

  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    createMenuDom();
    toggleMenu();
  });

  wrapper.appendChild(btn);
  bar.prepend(wrapper);

  // 点击别处关闭
  document.addEventListener("click", (ev) => {
    if (!popperWrapper || !buttonEl) return;
    const target = ev.target as Node;
    if (!popperWrapper.contains(target) && !buttonEl.contains(target)) {
      closeMenu();
    }
  });

  // 滚动 / resize 时，如果菜单开着，就重新定位
  const reposition = () => {
    if (popperWrapper && popperWrapper.style.display === "block") {
      openMenu();
    }
  };
  window.addEventListener("scroll", reposition, { passive: true });
  window.addEventListener("resize", reposition, { passive: true });

  mounted = true;
}

// ---------- 统计 & 渲染 ----------
let timer: number | null = null;
let lastRun = 0;

function scheduleCompute(delay = 200) {
  if (timer) clearTimeout(timer);
  timer = window.setTimeout(computeAndRender, delay);
}

function computeAndRender() {
  try {
    const now = performance.now();
    if (now - lastRun < 100) return;
    lastRun = now;

    ensureUiMounted();
    if (!mounted) return;

    const encoder = getEncoder(currentEnc);
    const texts = getTextsFromPage();
    let total = 0;

    for (const t of texts) {
      total += encoder.encode(t).length;
    }

    const chars = texts.join("\n").length;
    const turns = texts.length;

    if (labelSpan) {
      const k = total / 1000;
      labelSpan.textContent = `${k.toFixed(1)}k tokens`;
    }
    if (charsItem) charsItem.textContent = `Chars: ${chars}`;
    if (turnsItem) turnsItem.textContent = `Turns: ${turns}`;
    if (encoderItem) encoderItem.textContent = `Encoder: ${currentEnc}`;
  } catch (e) {
    console.error("[TokenCounter] error:", e);
    if (labelSpan) labelSpan.textContent = "Token: error";
  }
}

// ---------- DOM 变化：只读，触发重算 ----------
function getObserveTarget(): Node {
  // id 为 page-header 的标签
  const header = document.querySelector<HTMLElement>("#page-header");
  // 并行的下一个标签作为监听目标
  if (header && header.nextElementSibling) {
    return header.nextElementSibling;
  }
  // 兜底：找不到就先监听 body，避免完全不工作
  return document.body;
}

const mo = new MutationObserver(() => scheduleCompute(300));
mo.observe(getObserveTarget(), {
  childList: true,
  subtree: true,
  characterData: true,
});

window.addEventListener("scroll", () => scheduleCompute(500), { passive: true });
window.addEventListener("resize", () => scheduleCompute(500), { passive: true });

scheduleCompute(0);
