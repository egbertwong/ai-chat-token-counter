import { TokenHandler } from "../core/types";
import { fromPreTrained } from "@lenml/tokenizer-gemini";

const BUTTON_ID = "gemini-token-counter";
const DEBUG_LOG = false;

export class GeminiHandler implements TokenHandler {
    private tokenizer: any = null;
    private containerEl: HTMLElement | null = null;
    private labelSpan: HTMLSpanElement | null = null;
    private timer: number | null = null;
    private lastRun = 0;
    private mo: MutationObserver | null = null;
    private observeTargets: Node[] = [];
    private urlCheckTimer: number | null = null;
    private lastHref = location.href;

    async init() {
        try {
            this.tokenizer = await fromPreTrained();
        } catch (e) {
            console.error("[GeminiToken] Failed to load tokenizer:", e);
        }

        this.updateObserverTarget();
        this.scheduleCompute(0);

        this.urlCheckTimer = window.setInterval(() => {
            const href = location.href;
            if (href !== this.lastHref) {
                this.lastHref = href;
                this.onUrlChange();
            }
        }, 500);
    }

    destroy() {
        if (this.urlCheckTimer) clearInterval(this.urlCheckTimer);
        if (this.mo) this.mo.disconnect();
        document.getElementById(BUTTON_ID)?.remove();
    }

    private getTextsFromPage(): string[] {
        const userNodes = document.querySelectorAll("user-query-content");
        const modelNodes = document.querySelectorAll("message-content");

        const texts: string[] = [];

        userNodes.forEach(n => {
            texts.push((n.textContent || "").trim());
        });

        modelNodes.forEach(n => {
            texts.push((n.textContent || "").trim());
        });

        const inputArea = document.querySelector(".ql-editor");
        if (inputArea) {
            texts.push((inputArea.textContent || "").trim());
        }

        return texts.filter(Boolean);
    }

    private ensureUiMounted() {
        // 寻找注入点：Gemini 顶部的按钮容器
        // 根据用户提供的片段，目标是一个包含 pillbox 或 studio-sidebar-button 的 .buttons-container
        const headerButtons = document.querySelector(".buttons-container:has(.pillbox), .buttons-container:has(studio-sidebar-button)");
        const injectionPoint = headerButtons || document.querySelector(".buttons-container");

        if (!injectionPoint) return;

        let existing = document.getElementById(BUTTON_ID);
        if (existing) {
            this.containerEl = existing as HTMLElement;
            this.labelSpan = existing.querySelector(".token-label");
            // 确保它在最前面
            if (injectionPoint.firstChild !== existing) {
                injectionPoint.insertBefore(existing, injectionPoint.firstChild);
            }
            return;
        }

        const container = document.createElement("button");
        container.id = BUTTON_ID;
        container.type = "button";

        // Match the user-provided native class style: conversation-actions-menu-button
        container.style.cssText = `
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0 16px;
            margin-right: 8px;
            background-color: transparent;
            border: none;
            border-radius: 100px;
            font-family: "Google Sans", Roboto, sans-serif;
            font-size: 14px;
            font-weight: 500;
            color: #444746;
            cursor: pointer;
            user-select: none;
            height: 40px;
            transition: background-color 0.2s;
            outline: none;
        `;

        const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (isDark) {
            container.style.color = "#e3e3e3";
        }

        container.onmouseenter = () => {
            container.style.backgroundColor = isDark ? "rgba(227, 227, 227, 0.08)" : "rgba(68, 71, 70, 0.08)";
        };
        container.onmouseleave = () => {
            container.style.backgroundColor = "transparent";
        };

        const icon = document.createElement("span");
        icon.textContent = "✧";
        icon.style.marginRight = "8px";
        icon.style.color = "#1a73e8";
        icon.style.fontSize = "18px";
        icon.style.display = "flex";
        icon.style.alignItems = "center";

        const label = document.createElement("span");
        label.className = "token-label conversation-title gds-title-m";
        label.textContent = "0 tokens";
        this.labelSpan = label;

        container.appendChild(icon);
        container.appendChild(label);
        this.containerEl = container;

        // 插入到容器最前方
        injectionPoint.insertBefore(container, injectionPoint.firstChild);
    }

    private scheduleCompute(delay = 200) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = window.setTimeout(() => this.computeAndRender(), delay);
    }

    private computeAndRender() {
        try {
            const now = performance.now();
            if (now - this.lastRun < 100) return;
            this.lastRun = now;

            this.ensureUiMounted();
            if (!this.labelSpan) return;

            const texts = this.getTextsFromPage();
            let totalTokens = 0;

            if (this.tokenizer) {
                for (const t of texts) {
                    totalTokens += this.tokenizer.encode(t).length;
                }
            } else {
                this.labelSpan.textContent = "Loading...";
                return;
            }

            if (totalTokens >= 1000) {
                this.labelSpan.textContent = `${(totalTokens / 1000).toFixed(1)}k tokens`;
            } else {
                this.labelSpan.textContent = `${totalTokens} tokens`;
            }

            if (DEBUG_LOG) {
                const totalChars = texts.join("").length;
                console.log(`[GeminiToken] Tokens: ${totalTokens}, Chars: ${totalChars}`);
            }
        } catch (e) {
            console.error("[GeminiToken] error:", e);
            if (this.labelSpan) this.labelSpan.textContent = "Error";
        }
    }

    private getObserveTargets(): Node[] {
        const history = document.querySelector("#chat-history");
        const header = document.querySelector(".buttons-container");
        const input = document.querySelector(".input-area-container");
        const targets: Node[] = [document.body];
        if (history) targets.push(history);
        if (header) targets.push(header);
        if (input) targets.push(input);
        return targets;
    }

    private updateObserverTarget() {
        const newTargets = this.getObserveTargets();
        const same =
            this.observeTargets.length === newTargets.length &&
            newTargets.every((t, idx) => this.observeTargets[idx] === t);
        if (same) return;

        this.observeTargets = newTargets;
        if (this.mo) this.mo.disconnect();

        this.mo = new MutationObserver(() => {
            this.scheduleCompute(0);
            this.updateObserverTarget();
        });

        this.observeTargets.forEach((t) =>
            this.mo!.observe(t, {
                childList: true,
                subtree: true,
                characterData: true,
            })
        );
    }

    private onUrlChange() {
        this.containerEl = null;
        this.labelSpan = null;
        document.getElementById(BUTTON_ID)?.remove();
        this.updateObserverTarget();
        this.scheduleCompute(0);
    }
}
