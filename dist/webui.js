/**
 * 鱼的每一天面板的浏览器端（Coo WebUI 扩展面板）。
 *
 * 约定（见 build/cortico/src/web/shared/client-panel.ts）：
 *   · 默认导出 `{ panels: { <panelId>: { mount(ctx) } } }`
 *   · 只往 `ctx.root` 里写 DOM，不碰 document.body
 *   · 数据一律走 `ctx.invoke(method, args)`
 *
 * 样式随面板注入 ctx.root：实测只靠 dist/webui.css 的面板在宿主里会吃不到，
 * 而宿主可能是普通 DOM 也可能是 shadow root，注入 <style> 两边都成立。
 * 颜色主要走宿主主题的自定义属性（--surface/--foreground/--border/--accent…），
 * 自定义属性会继承进 shadow root，所以明暗两套主题都不用自己写。
 * 菜单纸皮肤（深浅宿主都生效）：把暖色颜料按固定比例混进宿主题色
 * （color-mix：浅底 → 米纸色，深底 → 暖炭色），菜名走衬线 --fe-serif
 * 与暖调墨 --fe-title，「端给她」等主按钮用固定的印章红 --fe-seal。
 *
 * 四个面板：
 *   menu    —— 翻菜单、看九维口味和实吃描写、点「端给她」
 *   combo   —— 一桌一桌地端：现成套餐，或自己攒一桌
 *   history —— 她吃过什么、攒出来的口味画像
 *   today   —— 她自己写下的这一天：此刻在哪一段、今天/明天的时间线、往期
 */

const CSS = `
.feast{--fe-line:color-mix(in srgb,var(--border,#e3e4e3) 88%,#a08050);--fe-ink:var(--foreground,#1b1a1e);--fe-dim:var(--muted-foreground,#5c5c60);--fe-card:color-mix(in srgb,var(--surface,#fbfbfb) 90%,#c9a26a);--fe-accent:var(--accent,#00a870);--fe-seal:#a32d2d;--fe-title:color-mix(in srgb,var(--foreground,#1b1a1e) 92%,#c9a26a);--fe-serif:var(--font-serif,"Noto Serif SC","Songti SC","SimSun",serif);font:14px/1.65 var(--sans,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif);color:var(--fe-ink);padding:4px 2px 24px;overflow-wrap:anywhere}
.feast *{box-sizing:border-box}
.feast-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.feast input,.feast select,.feast button,.feast textarea{font:inherit;color:inherit;background:var(--fe-card);border:1px solid var(--fe-line);border-radius:var(--radius-sm,6px);padding:6px 10px;min-width:0;max-width:100%}
.feast :is(button,input,select,summary,textarea,[role="button"],a[href]):focus-visible{outline:2px solid var(--fe-accent);outline-offset:3px}
.feast input:focus,.feast select:focus,.feast textarea:focus{border-color:var(--fe-accent)}
.feast textarea{width:100%;min-height:80px;resize:vertical}
.feast summary{cursor:pointer}
.feast-search{flex:1 1 150px;min-width:min(100%,150px)}
.feast button{cursor:pointer;transition:background .12s,border-color .12s;white-space:normal}
.feast button:hover{border-color:var(--fe-accent)}
.feast .feast-btn-primary{background:var(--fe-seal);border-color:var(--fe-seal);color:#fcebeb;font-weight:600}
.feast .feast-btn-primary:hover{border-color:var(--fe-seal);filter:brightness(1.06)}
.feast .feast-btn-primary[disabled]{opacity:.55;cursor:default;filter:none}
.feast-strip{border:1px solid var(--fe-line);border-left:3px solid var(--fe-accent);border-radius:var(--radius-sm,6px);padding:8px 11px;margin-bottom:12px;background:var(--fe-card);display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.feast-strip b{font-weight:600}
.feast-strip .feast-dim{color:var(--fe-dim)}
.feast-strip .feast-left{color:var(--fe-dim);font-size:12px;white-space:nowrap;margin-left:auto;font-variant-numeric:tabular-nums}
.feast-count{color:var(--fe-dim);font-size:12px;margin:2px 0 10px}
.feast-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,232px),1fr));gap:12px}
.feast-card{text-align:left;border:1px solid color-mix(in srgb,var(--fe-line) 65%,transparent);border-radius:var(--radius-md,10px);background:var(--fe-card);padding:12px 14px;min-width:0;cursor:pointer;display:flex;flex-direction:column;gap:5px;transition:border-color .12s}
.feast-card:hover{border-color:var(--fe-accent)}
.feast-card-h{display:flex;justify-content:space-between;gap:6px 10px;align-items:baseline;flex-wrap:wrap}
.feast-card-n{font-family:var(--fe-serif);font-weight:600;font-size:15px;color:var(--fe-title)}
.feast-card-m{color:var(--fe-dim);font-size:12px}
.feast-card-s{color:var(--fe-dim);font-size:12.5px;line-height:1.65;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.feast-tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:2px}
.feast-tag{font-size:11.5px;padding:1px 6px;border-radius:999px;border:1px solid var(--fe-line);color:var(--fe-dim)}
.feast-once{font-size:11.5px;color:var(--fe-accent);border:1px solid var(--fe-accent);border-radius:999px;padding:1px 6px;white-space:nowrap}
.feast-detail{display:flex;flex-direction:column;gap:12px;max-width:760px}
.feast-detail-h{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;border-bottom:3px double var(--fe-line);padding-bottom:10px}
.feast-detail-n{font-family:var(--fe-serif);font-size:19px;font-weight:600;line-height:1.3;color:var(--fe-title)}
.feast-detail-m{color:var(--fe-dim);font-size:12px;margin-top:2px}
.feast-block{border:1px solid color-mix(in srgb,var(--fe-line) 65%,transparent);border-radius:var(--radius-md,10px);background:var(--fe-card);padding:12px 14px;min-width:0}
.feast-block-t{font-size:12px;letter-spacing:.04em;color:var(--fe-dim);margin-bottom:7px;text-transform:uppercase}
.feast-prose{line-height:1.85;white-space:pre-wrap}
.feast-taste{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,168px),1fr));gap:5px 16px}
.feast-taste-row{display:flex;align-items:center;gap:8px;min-width:0}
.feast-taste-k{width:1.6em;color:var(--fe-dim);font-size:12px;flex:none}
.feast-taste-bar{flex:1;height:6px;border-radius:999px;background:color-mix(in srgb,var(--fe-ink) 10%,transparent);overflow:hidden}
.feast-taste-bar i{display:block;height:100%;border-radius:999px}
.feast-taste-v{width:2.2em;text-align:right;color:var(--fe-dim);font-size:11.5px;flex:none;font-variant-numeric:tabular-nums}
.feast-ing{display:flex;gap:6px;flex-wrap:wrap}
.feast-ing span{font-size:12px;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--fe-ink) 7%,transparent)}
.feast-line{color:var(--fe-dim)}
.feast-line b{color:var(--fe-ink);font-weight:600}
.feast-stats{display:flex;gap:12px;flex-wrap:wrap}
.feast-stat{flex:1;min-width:min(100%,96px);border:1px solid color-mix(in srgb,var(--fe-line) 65%,transparent);border-radius:var(--radius-md,10px);background:var(--fe-card);padding:12px 14px}
.feast-stat-v{font-size:20px;font-weight:600;line-height:1.35}
.feast-stat-k{font-size:12px;color:var(--fe-dim);margin-top:3px}
.feast-list{display:flex;flex-direction:column;gap:0}
.feast-item{display:flex;gap:6px 10px;align-items:baseline;flex-wrap:wrap;padding:8px 2px;border-bottom:1px solid var(--fe-line)}
.feast-item:last-child{border-bottom:0}
.feast-item-t{color:var(--fe-dim);font-size:12px;flex:none;font-variant-numeric:tabular-nums}
.feast-item-n{flex:1;min-width:0}
.feast-flag{font-size:11.5px;padding:1px 6px;border-radius:999px;border:1px solid var(--fe-line);color:var(--fe-dim);flex:none;max-width:100%}
.feast-flag.is-owner{border-color:var(--fe-accent);color:var(--fe-accent)}
.feast-empty{color:var(--fe-dim);padding:18px 4px}
.feast-empty.is-bad{color:var(--danger,#b45950)}
.feast-toast{position:sticky;bottom:0;margin-top:12px;border:1px solid var(--fe-accent);border-radius:var(--radius-sm,6px);background:var(--fe-card);padding:7px 11px;font-size:12.5px}
.feast-toast.is-bad{border-color:var(--danger,#b45950)}
/* --- 套餐面板 --- */
.feast-combo-h{font-size:12px;letter-spacing:.04em;color:var(--fe-dim);text-transform:uppercase;margin:20px 0 9px}
.feast-combo-h:first-of-type{margin-top:4px}
.feast-set{border:1px solid color-mix(in srgb,var(--fe-line) 65%,transparent);border-radius:var(--radius-md,10px);background:var(--fe-card);padding:12px 14px;display:flex;flex-direction:column;gap:7px;min-width:0}
.feast-set-h{display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap}
.feast-set-n{font-family:var(--fe-serif);font-weight:600;font-size:15px;color:var(--fe-title)}
.feast-set-m{color:var(--fe-dim);font-size:12px}
.feast-set-d{color:var(--fe-dim);font-size:12.5px;line-height:1.65}
.feast-set-dishes{display:flex;gap:5px;flex-wrap:wrap}
.feast-set-dishes span{font-size:11.5px;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--fe-ink) 7%,transparent)}
.feast-set-acts{display:flex;gap:7px;flex-wrap:wrap;margin-top:2px}
.feast-set.is-cur{border-color:var(--fe-accent)}
.feast-pick{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,170px),1fr));gap:6px;max-height:340px;overflow:auto;padding:4px}
.feast-chip{display:flex;gap:6px;align-items:center;border:1px solid var(--fe-line);border-radius:var(--radius-sm,6px);background:var(--fe-card);padding:6px 9px;min-width:0;cursor:pointer;text-align:left;font-size:13px}
.feast-chip:hover{border-color:var(--fe-accent)}
.feast-chip.is-on{border-color:var(--fe-accent);background:color-mix(in srgb,var(--fe-accent) 12%,var(--fe-card))}
.feast-chip-n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.feast-chip-m{color:var(--fe-dim);font-size:11.5px;flex:none}
.feast-build{display:flex;flex-direction:column;gap:9px;border:1px solid var(--fe-line);border-radius:var(--radius-md,10px);background:var(--fe-card);padding:12px 14px;min-width:0}
.feast-build-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.feast-build-bar .feast-search{min-width:min(100%,130px)}
.feast-miss{color:var(--danger,#b45950);font-size:12px}
.feast-strip .feast-left.is-done{color:var(--fe-accent)}
/* --- 一起吃饭（会话条；挂在菜单面板顶部，不新开面板） --- */
.feast-together{display:flex;flex-direction:column;gap:7px;border:1px solid var(--fe-accent);border-radius:var(--radius-md,10px);background:var(--fe-card);padding:9px 12px;margin-top:10px}
.feast-together-h{display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap}
.feast-together-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:var(--fe-dim);font-size:12px}
.feast-together-bar{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.feast-together-bar .feast-search{flex:1 1 130px;min-width:min(100%,130px)}
/* --- 今天（她的一天）面板 --- */
.feast-tl{display:flex;flex-direction:column;gap:0}
.feast-tl-row{position:relative;display:flex;gap:6px 12px;align-items:baseline;flex-wrap:wrap;padding:11px 10px 11px 28px;min-width:0;border:0;border-radius:var(--radius-sm,6px)}
.feast-tl-row::before{content:"";position:absolute;left:11px;top:0;bottom:0;width:1px;background:var(--fe-line);pointer-events:none}
.feast-tl-row:first-child::before{top:21px}
.feast-tl-row:last-child::before{bottom:calc(100% - 21px)}
.feast-tl-row:only-child::before{display:none}
.feast-tl-row.is-now{background:color-mix(in srgb,var(--fe-accent) 7%,transparent)}
.feast-tl-row.is-now::before{background:color-mix(in srgb,var(--fe-accent) 55%,var(--fe-line))}
.feast-tl-row.is-past{opacity:1}
.feast-tl-row.is-past::before{opacity:.45}
.feast-tl-t{color:var(--fe-dim);font-size:12px;flex:none;width:6.8em;font-variant-numeric:tabular-nums}
.feast-tl-n{flex:1 1 140px;display:flex;flex-direction:column;gap:3px;min-width:0}
.feast-tl-a{font-size:14px;font-weight:600;line-height:1.65}
.feast-tl-d{color:var(--fe-dim);font-size:12.5px;line-height:1.65}
.feast-tl-row.is-now .feast-tl-a{font-size:15px;color:var(--fe-title)}
.feast-day{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin:20px 0 9px}
.feast-day b{font-size:15px;font-weight:600}
.feast-day:first-child{margin-top:0}
.feast-day .feast-dim{color:var(--fe-dim);font-size:12px}
.feast-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center;min-width:0}
.feast-form .feast-time{flex:0 1 5.6em;width:5.6em;min-width:0;text-align:center;font-variant-numeric:tabular-nums}
.feast-form .feast-activity{flex:1 1 160px;min-width:min(100%,130px)}
.feast-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.feast-note{color:var(--fe-dim);font-size:12.5px;line-height:1.65;margin-top:6px}
.feast-item.is-click{cursor:pointer}
.feast-item.is-click:hover .feast-item-n{text-decoration:underline}
/* --- 时间线：可点、饭点标记 --- */
.feast-tl-row.is-click{cursor:pointer}
.feast-tl-row.is-click:hover{background:color-mix(in srgb,var(--fe-accent) 5%,transparent)}
.feast-tl-row.is-click:hover .feast-tl-a{text-decoration:underline}
.feast-tl-row.is-now.is-click:hover{background:color-mix(in srgb,var(--fe-accent) 9%,transparent)}
.feast-meal{font-size:11.5px;padding:1px 6px;border-radius:999px;border:1px dashed var(--fe-line);color:var(--fe-dim);flex:none;max-width:100%;white-space:normal;font-variant-numeric:tabular-nums}
.feast-meal.is-done{border-style:solid;border-color:var(--fe-accent);color:var(--fe-accent)}
.feast-invite-note{flex:1 1 150px;min-width:min(100%,150px)}
/* --- 今天：首页状态与分类时间轴 --- */
.feast-today-home{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:16px 20px;margin-bottom:20px}
.feast-today-home .feast-stat{min-width:0;border:0;border-top:1px solid var(--fe-line);border-radius:0;background:transparent;padding:12px 0 0}
.feast-today-status{grid-column:1/-1;display:flex;flex-direction:column;gap:7px}
.feast-today-status-h{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.feast-today-title{font-family:var(--fe-serif);font-size:18px;font-weight:600;line-height:1.45;color:var(--fe-title)}
.feast-today-mood{color:var(--fe-dim);font-size:12.5px}
.feast-status-line{display:flex;gap:7px;align-items:baseline;flex-wrap:wrap;font-size:12.5px;color:var(--fe-dim)}
.feast-work-pill{border:1px solid var(--fe-line);border-radius:999px;padding:1px 7px;color:var(--fe-dim);font-size:11.5px;max-width:100%}
.feast-work-pill.is-on{border-color:var(--fe-accent);color:var(--fe-accent)}
.feast-work-retained,.feast-reminders{padding-top:8px;border-top:1px solid color-mix(in srgb,var(--fe-line) 65%,transparent);overflow-wrap:anywhere}
.feast-reminders{margin-top:9px}
.feast-reminders b{color:var(--fe-title);font-variant-numeric:tabular-nums}
.feast-actual-stream{display:flex;flex-direction:column;gap:0}
.feast-actual-row{display:flex;gap:6px 9px;align-items:baseline;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid color-mix(in srgb,var(--fe-line) 65%,transparent)}
.feast-actual-row:last-child{border-bottom:0}
/* 宿主隐藏原生勾选框后，通用 input 背景会盖住勾选态；记录选择交回浏览器绘制。 */
.feast .feast-actual-row>input[type="checkbox"]{appearance:auto;-webkit-appearance:auto;flex:none;width:18px;height:18px;padding:0;margin:0;accent-color:var(--fe-accent)}
.feast-category{display:inline-block;font-size:11.5px;font-weight:400;line-height:1.5;padding:1px 6px;border:1px solid var(--fe-line);border-radius:999px;color:var(--fe-dim);white-space:normal;max-width:100%;flex:none}
.feast-tl-a .feast-category{margin-left:7px;vertical-align:baseline}
.feast-tl-row[data-category="sleep"]{--fe-timeline-tone:#8fa0bd}
.feast-tl-row[data-category="work"]{--fe-timeline-tone:#c3a274}
.feast-tl-row[data-category="commute"]{--fe-timeline-tone:#86b7aa}
.feast-tl-row[data-category="meal"]{--fe-timeline-tone:#d5a082}
.feast-tl-row[data-category="personal"]{--fe-timeline-tone:#ad9cc5}
.feast-tl-dot{position:absolute;left:7.5px;top:17px;width:8px;height:8px;border-radius:50%;background:var(--fe-timeline-tone,var(--fe-line));pointer-events:none}
.feast-tl-row.is-now .feast-tl-dot{background:var(--fe-accent);outline:3px solid color-mix(in srgb,var(--fe-accent) 18%,var(--fe-card));outline-offset:2px}
.feast-tl-row.is-past .feast-tl-dot{opacity:.5}
.feast-tl-detail{margin-top:3px;font-size:12.5px}
.feast-tl-detail summary{color:var(--fe-dim)}
.feast-tl-detail[open] summary{margin-bottom:5px}
.feast-work-preview{border:1px solid var(--fe-accent);border-radius:var(--radius-md,10px);padding:9px 11px;margin-top:9px;background:color-mix(in srgb,var(--fe-accent) 5%,var(--fe-card))}
.feast-work-compare{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:8px}
.feast-work-side{border:1px solid var(--fe-line);border-radius:var(--radius-sm,6px);padding:7px 9px;min-width:0}
.feast-work-side ul{margin:5px 0 0;padding-left:19px;color:var(--fe-dim)}
.feast-work-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}
.feast-tomorrow-state{margin:6px 0 10px;padding:7px 10px;border-left:2px solid var(--fe-line);background:color-mix(in srgb,var(--fe-ink) 3%,transparent);color:var(--fe-dim)}
.feast-free-plan{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0;padding:9px 11px;border:1px solid var(--fe-line);border-radius:var(--radius-md,10px);background:var(--fe-card)}
.feast-free-plan .feast-note{margin:0;flex:1 1 180px;min-width:min(100%,180px)}
.feast-timeline-toggle{display:flex;justify-content:space-between;align-items:center;width:100%;margin:10px 0 4px;text-align:left}
.feast-tl-row[role="button"]:focus-visible,.feast-timeline-toggle:focus-visible{outline:2px solid var(--fe-accent);outline-offset:2px}
.feast-timeline-details[hidden]{display:none}
.feast-today-top{grid-column:1/-1;display:flex;gap:7px 10px;align-items:baseline;flex-wrap:wrap;padding:4px 0 15px;border-bottom:1px solid var(--fe-line)}
.feast-today-top>b{font-size:13px;font-weight:500;color:var(--fe-dim)}
.feast-today-actual{grid-column:1/-1}
.feast-today-top .feast-today-title{flex:1 1 100%;font-size:22px;line-height:1.4}
.feast-current-plan,.feast-today-home .feast-current-plan{grid-column:1/-1;min-width:0;border:0;border-left:3px solid var(--fe-accent);border-radius:var(--radius-sm,6px);padding:14px 16px;background:var(--fe-card)}
.feast-current-plan .feast-stat-v{font-size:15px;line-height:1.65;color:var(--fe-title)}
.feast-current-plan .feast-note{margin:4px 0 8px}
.feast-today-controls{margin-top:24px;padding-top:12px;border-top:1px solid var(--fe-line);min-width:0}
.feast-today-controls>summary{width:fit-content;max-width:100%;padding:5px 0;font-size:13px;color:var(--fe-dim)}
.feast-today-controls[open]>summary{margin-bottom:12px;color:var(--fe-ink)}
/* --- 生活记录、套餐预览与就地回执 --- */
.feast-journal{display:flex;flex-direction:column;gap:12px;min-width:0;margin-top:16px}
.feast-memory-card{min-width:0;padding:12px 0;border-bottom:1px solid color-mix(in srgb,var(--fe-line) 65%,transparent);font-size:14px;line-height:1.75}
.feast-memory-card:last-child{border-bottom:0}
.feast-memory-card .feast-note{margin-top:4px}
.feast-memory-card :is(h3,h4){margin:0 0 6px;font-family:var(--fe-serif);font-size:15px;font-weight:600;color:var(--fe-title)}
.feast-memory-card p{margin:5px 0}
.feast-preset-preview{min-width:0;margin-top:10px;padding:11px 13px;border:1px solid color-mix(in srgb,var(--fe-line) 65%,transparent);border-radius:var(--radius-sm,6px);background:var(--fe-card);font-size:13px;line-height:1.7}
.feast-preset-preview .feast-set-n{display:block;margin-bottom:5px}
.feast-menu-shortcuts{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:10px 0 4px;min-width:0}
.feast-menu-shortcuts button{flex:0 1 auto;font-size:13px}
.feast-menu-shortcuts button[aria-pressed="true"]{border-color:var(--fe-accent);background:color-mix(in srgb,var(--fe-accent) 10%,var(--fe-card));font-weight:600}
.feast :is(input,select,textarea){max-width:100%}
.feast-memory-card textarea{display:block;width:100%;min-width:0;min-height:8em;resize:vertical;line-height:1.65}
.feast-feedback{margin-top:10px;padding:8px 11px;border-left:2px solid var(--fe-accent);border-radius:var(--radius-sm,6px);background:color-mix(in srgb,var(--fe-accent) 5%,var(--fe-card));font-size:13px;line-height:1.65;overflow-wrap:anywhere}
.feast-feedback.is-bad{border-left-color:var(--danger,#b45950)}
.feast-feedback:empty,.feast-preset-preview:empty{display:none}
@media(max-width:480px){
.feast-grid{gap:10px}.feast-card,.feast-block,.feast-set,.feast-build{padding:11px 12px}
.feast-today-home{grid-template-columns:minmax(0,1fr);gap:14px}.feast-today-top .feast-today-title{font-size:20px}
.feast-today-home .feast-current-plan{padding:12px 13px}
.feast-tl-row{gap:3px 8px;flex-wrap:wrap;padding:10px 6px 12px 26px}
.feast-tl-t{width:auto;flex-basis:100%;font-size:12px}.feast-tl-n{flex-basis:100%}.feast-tl-d{font-size:12.5px}
.feast-actual-row{gap:5px 8px}.feast-actual-row .feast-item-n{flex-basis:100%}
.feast-form :is(.feast-activity,select),.feast-free-plan .feast-note{flex:1 1 100%;min-width:0}
.feast-bar .feast-search,.feast-build-bar .feast-search,.feast-together-bar .feast-search{min-width:0;flex-basis:100%}
.feast-together-bar>input,.feast-free-plan .feast-note{min-width:0}.feast-strip .feast-left{white-space:normal;margin-left:0}
.feast-item-n{flex-basis:140px}.feast-menu-shortcuts button{flex:1 1 120px}
}
.feast-date-navigation{position:sticky;top:0;z-index:2;max-width:100%;padding:7px 0;background:var(--fe-card);border-bottom:1px solid var(--fe-line);margin-bottom:12px}
.feast-datebar{display:flex;flex-wrap:wrap;align-items:center;gap:7px}
.feast-datebar .feast-date-current{font-weight:600;min-width:11em}
.feast-calendar{max-width:340px;margin-top:8px;padding:10px;border:1px solid var(--fe-line);border-radius:var(--radius-md,10px);background:var(--fe-card)}
.feast-calendar-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}
.feast-calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}
.feast-calendar-grid>span{text-align:center;color:var(--fe-dim);font-size:12px}
.feast-calendar-grid button{min-width:0;min-height:42px;padding:3px;display:flex;flex-direction:column;align-items:center;gap:1px}
.feast-calendar-grid button[aria-pressed="true"]{border-color:var(--fe-accent);background:color-mix(in srgb,var(--fe-accent) 10%,var(--fe-card))}
.feast-calendar-grid button:disabled{opacity:.4;cursor:default}
.feast-calendar-marks{font-size:11.5px;line-height:1;color:var(--fe-accent);min-height:1em}
.feast-view-status:empty{display:none}.feast-view-status{margin-bottom:8px}
.feast-journal-records{display:flex;flex-direction:column;gap:5px;min-width:0}
.feast-journal-cards>details>summary{cursor:pointer;font-size:13px;line-height:1.65}
.feast-journal-cards>details[open]>summary{margin-bottom:7px}
.feast-journal-tools{margin-top:7px}
@media(prefers-reduced-motion:reduce){.feast,.feast *,.feast *::before,.feast *::after{animation:none!important;transition:none!important;transform:none!important;scroll-behavior:auto!important}}
`;

const TABLE = {
  zh: {
    allCuisines: '全部菜系',
    uiUpdating: "正在更新…",
    uiRefreshFailed: "暂未刷新，原内容已保留。",
    uiSavedRefreshFailed: "操作已完成，显示暂未更新；可重试读取。",
    uiDetailFailed: "菜品详情暂未读取，原页面已保留。",
    uiRetry: "重试读取",
    uiInviteSent: "邀请已发出，等待她回应。",
    uiServeWaiting: (name) => `${name || "餐点"}已上桌，等待她来吃。`,
    uiTitleSaved: (date) => `${date}的小标题已保存。`,
    uiCardSaved: (date) => `${date}的纪念卡已保存，可展开下载文字。`,
    uiPresetSaved: (name) => `已应用${name}，已有日程保持原样。`,
    uiReviewTitle: (date) => `${date}的回顾`,
    uiReviewLoading: (date) => `正在读取${date}的回顾…`,
    uiPreviousDay: "上一天",
    uiNextDay: "下一天",
    uiReturnToday: "回到今天",
    uiOpenCalendar: "选择日期",
    uiPreviousMonth: "上个月",
    uiNextMonth: "下个月",
    uiCalendarLoading: "正在读取这个月的记录标记…",
    uiCalendarFailed: "日期标记暂未更新，仍可选择日期。",
    uiCalendarLegend: "● 可用实际记录　◇ 纪念卡；无标记不代表当天没有活动。",
    uiHasActual: "有可用实际记录",
    uiHasCards: "有纪念卡",
    uiUnknownRecords: "部分记录暂时无法读取",
    uiNoAvailableRecords: "当前没有可用记录标记",
    uiNewDay: "已经进入新的一天，当前阅读内容和草稿仍保留。",
    uiPlanSent: "邀请已发出，原计划保留，等待她回应。",
    uiRecordsUpdated: "有新记录，已更新实际记录列表。",
    uiCardBody: "展开纪念卡正文",
    uiExpandRecords: "展开全部实际记录",
    uiCollapseRecords: "收起较早记录",
    uiHistoryPlan: "当时的计划",
    uiHistoryActual: "这一天留下的实际记录",
    uiNothingSelected: "请选择日期查看回顾。",
    quickAll: "全部",
    quickLiked: "她喜欢的",
    quickUntried: "还没尝过",
    quickRecent: "最近吃过",
    discover: "今天换换口味",
    discoverEmpty: "当前筛选下没有可推荐的菜。",
    discoverHint: "最多三道候选，挑选不等于吃过。",
    saving: "正在保存…",
    saved: "已保存",
    previewing: "正在预览…",
    controlsTitle: "生活设置与调整",
    pastTitle: "生活回顾与往期",
    journalTitle: "当天的小标题",
    journalTitlePh: "手动留一句标题（最多60字）",
    journalSaveTitle: "保存小标题",
    journalUseTitle: "用作小标题",
    journalTools: "留个小标题或纪念卡",
    journalEmpty: "这一天没有可用的实际记录。",
    journalCoverage: "这里只展示当前仍保存的实际记录；没有记录不代表当天什么也没做。日程仍然只是打算。",
    journalSelect: "选择1–2条实际记录，留成文字纪念卡。",
    journalCardTitle: "纪念卡标题（可选）",
    journalSaveCard: "保存纪念卡",
    journalCards: "已保存的纪念卡",
    journalManual: "手动标题",
    journalDownload: "下载文字卡",
    journalExporting: "正在导出…",
    journalExportReady: "文字已展开，可下载或手动复制。",
    journalDownloadUnavailable: "当前环境不支持下载，请复制下方文字。",
    journalBadSelection: "请选择1–2条实际记录。",
    journalDate: "回看日期",
    journalOpen: "查看这一天",
    journalMissing: "这一天尚未保存小标题或纪念卡。",
    presetTitle: "生活提醒预设",
    presetHint: "只调整下面列出的提醒设置，不改工作规则、饭点时刻、联动或已有日程。应用后仍能单独调整。",
    presetQuiet: "安静陪伴",
    presetDaily: "日常生活",
    presetLively: "多一点互动",
    presetPreview: "预览修改",
    presetApply: "确认应用这套设置",
    presetCancel: "取消预览",
    presetCurrent: "当前",
    presetAfter: "应用后",
    presetNoChanges: "已经是这套设置，无需修改。",
    presetUnavailable: "当前宿主未提供保存配置接口，只能预览。",
    presetOn: "开启",
    presetOff: "关闭",
    presetEmpty: "未设置",
    presetFields: {"mealReminder":"饭点提醒","mealMaxRetries":"每顿最多再催几次","lifeFreeEnabled":"自由时间提醒","lifeFreeSlots":"自由时间档位","lifeFreeBusyCall":"忙着的时候也叫","lifeMomentEvents":"时段切换事件","lifeFreeAskReport":"提醒她报备"},
    allCats: '全部类别',
    search: '搜菜名 / 产地 / 食材',
    random: '随机一道',
    serve: '端给她',
    serving: '端过去了…',
    back: '← 回菜单',
    pending: '还在她面前',
    pendingHint: '等她用 feast_eat 尝',
    pendingLeft: (m) => (m > 0 ? `还剩约 ${m} 分钟` : '就快收了'),
    pendingGone: '已经收走了',
    matched: (n, total) => `筛出 ${n} 道 / 共 ${total} 道`,
    all: (n) => `共 ${n} 道菜`,
    eatenTimes: (n) => (n ? `吃过 ${n} 回` : '还没吃过'),
    ingredients: '食材',
    method: '做法',
    servingLabel: '上桌',
    taste: '味道',
    texture: '口感',
    aroma: '香气',
    finish: '余韵',
    prose: '这一道吃下去',
    tags: '标签',
    statTotal: '吃过多少回',
    statToday: '今天',
    statKnown: '尝过的菜',
    profile: '口味画像',
    noProfile: '还没吃过什么，画像还是空的。',
    top: '吃得最多',
    recent: '最近几口',
    reactions: '她记过的反应',
    miss: '那次不太对付',
    owner: '主人端的',
    ownerBite: '主人喂的一口',
    like: '好吃',
    dislike: '不对付',
    ok: '一般',
    empty: '没有符合条件的菜。',
    loading: '翻菜单…',
    failed: (e) => `取不到数据：${e}`,
    served: (n) => `端过去了：${n}`,
    /* --- 通用回执（0.7.2：以前这些是散在各处的硬编码中文，切英文也不变） --- */
    sayOk: '记下了',
    sayNo: '不行',
    sayCancel: '取消',
    retract: '收回',
    retracted: (n) => `收回来了：${n}`,
    retractNone: '现在没有摆在她面前的菜。',
    more: (n) => `再看 ${n} 道`,
    shownOf: (a, b) => `画了 ${a} / ${b} 道`,
    /* --- 套餐面板 --- */
    comboPresets: '现成的套餐',
    comboCustom: '你自己攒的',
    comboNone: '还没攒过。下面勾几道，起个名字存下来。',
    comboBuild: '攒一桌',
    comboNamePh: '给这一桌起个名字',
    comboPicked: (n, max) => `已选 ${n} / ${max} 道`,
    comboPick: '换一桌',
    comboServe: '端这一桌',
    comboPicking: '配菜中…',
    comboSaving: '存…',
    comboRemove: '删',
    comboConfirmRemove: '再点一次就删掉',
    comboEdit: '改',
    comboEmpty: '这一桌配不出菜来。',
    comboHint: '点菜卡选或取消；选好了存下来，下次直接端。',
    comboTable: '这一桌',
    comboLeft: (n, t) => `还剩 ${n} / ${t} 道`,
    comboMissing: (s) => `少配了：${s}`,
    comboNoDish: '这一桌一道菜都选上',
    /* --- 一起吃饭（菜单面板顶部那条） --- */
    togetherNow: (min) => `正一起吃${min ? ` · ${min} 分钟了` : ''}`,
    togetherStartedByOwner: '起头的是主人',
    togetherStartedByHer: '起头的是她',
    togetherInvite: '🍽 一起吃',
    togetherInvitePh: '想先跟她说一句（可留空）',
    togetherHerAsk: (m) => `🍽 她说想和你一起吃饭（还剩约 ${m} 分钟）`,
    togetherAccept: '好，一起吃',
    togetherDecline: '今天不了',
    togetherEnd: '散桌',
    togetherOwnerAte: '主人也在吃',
    togetherNoDish: '只按你说的这句记',
    togetherBites: (n) => `喂过 ${n} 口`,
    togetherBack: (n) => `她分了你一口 ${n}`,
    togetherBackOk: '接过来',
    togetherBackNo: '下次吧',
    togetherBackYes: '接过去了',
    togetherBackNoDone: '这次没要',
    togetherTakePh: '我在吃…（一句话就行）',
    togetherTake: '记下来',
    togetherTakeThis: '我也吃这道',
    togetherBiteThis: '喂她一口',
    togetherLastEnd: (why) => `刚才那顿：${why}`,
    togetherEndWhyFinished: '她那份吃完了',
    togetherEndWhyOwner: '主人说散了',
    togetherEndWhyTtl: '放太久了，收了',
    togetherEndWhyHer: '她先收了',
    /* --- 今天（她的一天）面板 --- */
    dayNow: '此刻',
    dayNowAt: (hm) => `现在是 ${hm}`,
    daySleeping: '她睡着了',
    dayNothingNow: '这会儿没有安排',
    dayToday: '今天',
    dayTomorrow: '明天',
    dayPast: '往期',
    dayNoDay: '这一天她还没想好怎么过。',
    dayOff: '「她的一天」现在关着。到配置里打开 lifeEnabled 才会开始给她排日子。',
    dayAsk: '请她写明天',
    dayAsking: '已经跟她说了…',
    dayAskAgain: '请她重新想想',
    dayAskAgainHint: '她写好了才会盖掉现在这一版；不想改就留着。',
    dayRewriteConfirm: '明天她已经写好了。要请她重写吗？她想好了才会盖掉现在这一版。',
    dayWaiting: '已经在等她写了，到点没写会用模板兜底。',
    daySourceCoo: '她自己写的',
    daySourceTemplate: '临时顶上的',
    daySourcePending: '等她写',
    daySourceManual: '改过的',
    dayChange: '临时改主意',
    dayChangePh: '做什么（留空 = 不做了）',
    dayChangeGo: '改这一段时间',
    dayChangeHint: '填一段时间和一件事；不想做了就把「做什么」留空，那一段时间会空出来。原来压在这段上的安排会被截断或拆开。已经过去的时间改不了（那是事实）。点时间线上任意一段，会把它填进这里。',
    dayChangePicked: (s, e, a) => `已填入 ${s}–${e} ${a}，改完按「改这一段时间」。`,
    dayChanges: (n) => `临时改过 ${n} 次`,
    dayCount: (n) => `${n} 段`,
    dayClickHint: '点这一段改主意',
    dayNoPast: '还没有往期的那一天。',
    dayBack: '← 收起',
    dayMeal: '饭点',
    todayPlanTitle: '此刻的安排', todayActualTitle: '今天留下的事', todayNextTitle: '接下来',
    todayPlanDisclaimer: '这是计划，不代表事情已经发生。', todayActualEmpty: '还没有记下事情。',
    todayUpcoming: '接下来', todayPendingMeal: '有一份餐点还在等她', todayTogetherInvite: '她邀请你一起吃饭', todayTogetherActive: '你们正在一起吃饭',
    todayDate: '日期', todayMood: (m) => `心情：${m}`, todayWorking: '今天上班', todayNotWorking: '今天不上班', todayWorkUnknown: '还没安排',
    todayWorkReadError: '今天的安排读取失败', todayWorkRetained: '已关闭后续排班，今天的工作安排仍保留。', todayWorkAdjust: '调整今天',
    tomorrowWorkRetained: '已关闭后续排班，明天的工作安排仍保留。',
    reminderMeal: '饭点提醒', reminderFree: '自由时间提醒', reminderOff: '提醒已关闭', reminderUnavailable: '记录读取失败',
    reminderMealPaused: '她说今天不吃了', reminderFreePaused: '今天先别叫了', reminderUnconfigured: '未设置档位', reminderFinished: '今天没有下一档',
    reminderHer: '她自己定的', reminderConfig: '来自设置', reminderBusy: '按当前安排，这一档忙时不提醒',
    reminderAsleep: '按当前安排，这一档睡着时不提醒', reminderCheckIn: '按当前安排，这一档忙时只报备',
    reminderDue: '已到时间，等待下一次检查', reminderCatchUp: '待补提醒', reminderRetry: '待再次提醒',
    reminderWaiting: '这一档已提醒，等待回应', reminderCatchUpSlot: '补一档',
    reminderFreeSkipped: (slot, doing) => `${slot === '补' ? '补提醒' : slot} 没提醒 · ${doing ? `当时在${doing}` : '当时正忙'}`,
    todayCategory: { sleep: '睡眠', work: '工作', commute: '通勤', meal: '用餐', personal: '个人' },
    todayTomorrowEmpty: '明天还没有计划。', todayTomorrowPending: '已经请求她写明天，仍在等待回应。', todaySourceMissing: '尚未生成',
    todayTomorrowPendingAt: (s) => `请求发出于 ${s}`, todayTomorrowRequestAt: (s) => `请求时间：${s}`, todayTomorrowUpdatedAt: (s) => `更新时间：${s}`, todayTomorrowSummary: '明天摘要', todayTomorrowNoActivities: '还没有主要活动。', homeLabel: '家', todayTomorrowCoo: '明天的计划由她写下。', todayTomorrowTemplate: '明天暂由日程模板安排。',
    todayFreePlan: '请她想想空出来的时间', todayFreePending: '已经请她看看空出来的时间。', todayFreeNone: '今天没有明确留出的时间段。',
    workCompareTitle: '确认今天不上班', workBefore: '当前安排', workAfter: '不上班后', workNoChanges: '没有识别到工作或通勤时段；只会更新上班状态。',
    workCancel: '取消', workConfirm: '确认修改', workConflictNote: (n) => `仍有 ${n} 段工作安排未清理。`, workUndo: '撤销关闭上班', workUndoing: '正在撤销…',
    todayPlanSendAt: (s) => `请求时间：${s}`, todayPlanUpdatedAt: (s) => `更新时间：${s}`, todayTimelineLabel: '分类时间轴', todayTimelineOpen: '展开完整时间线', todayTimelineClose: '收起完整时间线', todayCategoryAuto: '自动分类', todayCategoryLabel: '活动分类', workPreviewTitle: '原安排与自由安排', workPreviewCancel: '取消', workPreviewConfirm: '确认今天不上班',
    workCategory: '工作', sleepCategory: '睡眠', commuteCategory: '通勤', mealCategory: '用餐', personalCategory: '个人',
    workActivity: '上班', sleepActivity: '睡觉', commuteActivity: '通勤', mealActivity: '吃饭', personalActivity: '自己的时间',
    workPreviewStale: '预览已过期，请重新预览后确认。',
    todayActualMeal: '餐食', todayActualActivity: '活动',
    todayStorage: '存储问题', todayReload: '重新读取', todayRestore: '从备份恢复', todayRestoreConfirm: (n) => `确认从备份恢复「${n}」？当前内容会被替换。`,
    todayThreadTitle: '她留下的线索', todayThreadPh: '记下一个想法…', todayThreadAdd: '记下想法', todayThreadOwner: '主人记下', todayThreadCoo: '她留下', todayThreadDone: '完成', todayThreadDrop: '搁下', todayThreadDoneLabel: '已完成', todayThreadDropLabel: '已搁下',
    todayPlanRetry: '重新发送', todayPlanRetryConfirm: '明天的计划还在等待中。要重新发送请求吗？',
    /* --- 长期工作排程 / 仅修改今天的安排 --- */
    workTitle: '上不上班（持续生效）', workOn: '开启长期工作排程', workOff: '关闭长期工作排程',
    workPolicyEnabled: '长期工作排程：开启', workPolicyDisabled: '长期工作排程：关闭',
    workPolicyHint: '关闭后，上班、加班、摸鱼日型权重都会变为 0，直到重新开启。已有计划不会自动更改，可在下方另行调整。',
    workPolicyError: '工作排程规则读取或保存失败，暂时无法切换。', workPolicySaving: '正在保存…',
    workDailyTitle: '仅修改今天的安排', workTodayOn: '今天照原安排上班', workTodayOff: '今天不上班（仅今天）',
    workHint: '这里只改今天的日程，不影响长期工作排程。不上班会先显示预览，确认后移除日程里的工作事件，其他安排保留。',
    workNone: '今天还没有可修改的日程；长期工作排程开关仍可使用。',
    mealByHer: '饭点由她定',
    mealByConfig: '饭点走配置',
    mealHerSlots: (s) => `她定的是 ${s}`,
    mealDefaultSlots: (s) => `默认档位 ${s}`,
    /* --- 自由时间 --- */
    freeTitle: '她自己的时间',
    freeOff: '自由时间关着。',
    freeDone: (n) => `今天记了 ${n} 件`,
    freeNext: (hm) => `下一档 ${hm}`,
    freeNone: '还没有排档',
    freeSkipped: '今天不按点叫了（她随时能自己动）',
    freeNotYet: '今天还没记过什么（不记也不影响她做事）。',
    freeHint: '到点会叫醒她「现在是你自己的时间」。下面这些只是例子：单子外的事、临时起意的都算，做不做、做几件都由她，想开始随时能开始、不用等叫醒。到她睡觉的时段不会叫；上班时段看她自己有没有开「忙着的时候也叫」。',
    freeSkippedSlot: (doing) => `没叫：她那会儿在${doing}`,
    freeSkippedHint: '（想让她上班时也叫：配置 →「她自己的时间」→「忙着的时候也叫」）',
    freeSkipToday: '今天先别叫了',
    freeSkipDone: '好了，今天剩下的档不叫了。',
    freeStart: '现在就想动',
    freeStartDone: '行，这会儿就由她自己安排。',
  },
  en: {
    allCuisines: 'All cuisines',
    uiUpdating: "Updating…",
    uiRefreshFailed: "Could not refresh. The current content is still here.",
    uiSavedRefreshFailed: "The action completed, but the view has not refreshed. Retry reading.",
    uiDetailFailed: "Could not load this dish. The current view is still here.",
    uiRetry: "Retry reading",
    uiInviteSent: "Invitation sent; waiting for her response.",
    uiServeWaiting: (name) => `${name || "The meal"} is on the table, waiting for her.`,
    uiTitleSaved: (date) => `The title for ${date} is saved.`,
    uiCardSaved: (date) => `The memory card for ${date} is saved. Expand it to download the text.`,
    uiPresetSaved: (name) => `${name} applied. Existing plans stay as they are.`,
    uiReviewTitle: (date) => `Review of ${date}`,
    uiReviewLoading: (date) => `Loading the review for ${date}…`,
    uiPreviousDay: "Previous day",
    uiNextDay: "Next day",
    uiReturnToday: "Back to today",
    uiOpenCalendar: "Choose a date",
    uiPreviousMonth: "Previous month",
    uiNextMonth: "Next month",
    uiCalendarLoading: "Loading this month’s record markers…",
    uiCalendarFailed: "Could not update the markers. Dates are still selectable.",
    uiCalendarLegend: "● Available actual records   ◇ Memory cards. No marker does not mean nothing happened.",
    uiHasActual: "Actual records available",
    uiHasCards: "Memory cards saved",
    uiUnknownRecords: "Some records could not be read",
    uiNoAvailableRecords: "No available record markers",
    uiNewDay: "A new day has started. Your current view and drafts are still here.",
    uiPlanSent: "Invitation sent. The original plan stays until she responds.",
    uiRecordsUpdated: "New actual records are shown below.",
    uiCardBody: "Expand memory-card text",
    uiExpandRecords: "Show all actual records",
    uiCollapseRecords: "Hide earlier records",
    uiHistoryPlan: "The plan for that day",
    uiHistoryActual: "Actual records for this day",
    uiNothingSelected: "Choose a date to review.",
    quickAll: "All",
    quickLiked: "She likes",
    quickUntried: "Not tried",
    quickRecent: "Recently eaten",
    discover: "Try a different flavour",
    discoverEmpty: "No recommendations match these filters.",
    discoverHint: "Up to three ideas. Choosing is not eating.",
    saving: "Saving…",
    saved: "Saved",
    previewing: "Preparing preview…",
    controlsTitle: "Life settings and adjustments",
    pastTitle: "Life reviews and past days",
    journalTitle: "A title for this day",
    journalTitlePh: "A manual title (up to 60 characters)",
    journalSaveTitle: "Save day title",
    journalUseTitle: "Use as day title",
    journalTools: "Keep a title or a memory card",
    journalEmpty: "No actual records are available for this day.",
    journalCoverage: "Only records still stored are shown. Missing records do not mean nothing happened. Plans remain intentions.",
    journalSelect: "Choose 1–2 actual records for a text memory card.",
    journalCardTitle: "Memory-card title (optional)",
    journalSaveCard: "Save memory card",
    journalCards: "Saved memory cards",
    journalManual: "Manual title",
    journalDownload: "Download text card",
    journalExporting: "Exporting…",
    journalExportReady: "Text is expanded below for download or copying.",
    journalDownloadUnavailable: "Downloads are unavailable here. Copy the text below.",
    journalBadSelection: "Choose 1–2 actual records.",
    journalDate: "Review date",
    journalOpen: "View this day",
    journalMissing: "No title or memory cards saved for this day yet.",
    presetTitle: "Life reminder presets",
    presetHint: "Only the reminder settings listed below change. Work rules, meal times, integrations and existing plans stay as they are. You can still adjust settings individually.",
    presetQuiet: "Quiet company",
    presetDaily: "Everyday life",
    presetLively: "A little more interaction",
    presetPreview: "Preview changes",
    presetApply: "Confirm and apply these settings",
    presetCancel: "Cancel preview",
    presetCurrent: "Current",
    presetAfter: "After applying",
    presetNoChanges: "These settings already match.",
    presetUnavailable: "This host does not provide configuration saving. Preview only.",
    presetOn: "On",
    presetOff: "Off",
    presetEmpty: "Not set",
    presetFields: {"mealReminder":"Meal reminders","mealMaxRetries":"Maximum meal retries","lifeFreeEnabled":"Free-time reminders","lifeFreeSlots":"Free-time slots","lifeFreeBusyCall":"Call while busy","lifeMomentEvents":"Schedule-change events","lifeFreeAskReport":"Ask for a check-in"},
    allCats: 'All categories',
    search: 'Search name / region / ingredient',
    random: 'Surprise me',
    serve: 'Put it down for her',
    serving: 'Serving…',
    back: '← Back to menu',
    pending: 'waiting in front of her',
    pendingHint: 'until she eats it with feast_eat',
    pendingLeft: (m) => (m > 0 ? `about ${m} min left` : 'almost over'),
    pendingGone: 'already cleared away',
    matched: (n, total) => `${n} of ${total} dishes`,
    all: (n) => `${n} dishes`,
    eatenTimes: (n) => (n ? `eaten ${n}×` : 'never eaten'),
    ingredients: 'Ingredients',
    method: 'Method',
    servingLabel: 'At the table',
    taste: 'Flavour',
    texture: 'Texture',
    aroma: 'Aroma',
    finish: 'Aftertaste',
    prose: 'How it eats',
    tags: 'Tags',
    statTotal: 'Meals eaten',
    statToday: 'Today',
    statKnown: 'Dishes known',
    profile: 'Taste profile',
    noProfile: 'Nothing eaten yet.',
    top: 'Most eaten',
    recent: 'Recent bites',
    reactions: 'Logged reactions',
    miss: 'that one missed',
    owner: 'served',
    ownerBite: 'a bite, fed by you',
    like: 'liked',
    dislike: 'missed',
    ok: 'ok',
    empty: 'Nothing matches.',
    loading: 'Loading…',
    failed: (e) => `Failed to load: ${e}`,
    served: (n) => `Served: ${n}`,
    /* --- shared receipts (0.7.2: these used to be hard-coded Chinese) --- */
    sayOk: 'Noted',
    sayNo: 'Cannot',
    sayCancel: 'Cancel',
    retract: 'Take back',
    retracted: (n) => `Taken back: ${n}`,
    retractNone: 'Nothing is sitting in front of her right now.',
    more: (n) => `Show ${n} more`,
    shownOf: (a, b) => `showing ${a} of ${b}`,
    /* --- combo panel --- */
    comboPresets: 'Ready-made sets',
    comboCustom: 'Your own tables',
    comboNone: 'None yet. Pick a few dishes below and save the table.',
    comboBuild: 'Build a table',
    comboNamePh: 'Name this table',
    comboPicked: (n, max) => `${n} / ${max} picked`,
    comboPick: 'Preview',
    comboServe: 'Serve this table',
    comboPicking: 'Resolving…',
    comboSaving: 'Saving…',
    comboRemove: 'Delete',
    comboConfirmRemove: 'Click again to delete',
    comboEdit: 'Edit',
    comboEmpty: 'Nothing resolves for this table.',
    comboHint: 'Tap cards to pick or unpick; save the table and serve it later.',
    comboTable: 'This table',
    comboLeft: (n, t) => `${n} of ${t} left`,
    comboMissing: (s) => `Missing: ${s}`,
    comboNoDish: 'Pick at least one dish',
    /* --- eating together (the bar at the top of the menu panel) --- */
    togetherNow: (min) => `Eating together${min ? ` · ${min} min in` : ''}`,
    togetherStartedByOwner: 'you started it',
    togetherStartedByHer: 'she started it',
    togetherInvite: '🍽 Eat together',
    togetherInvitePh: 'Say something first (optional)',
    togetherHerAsk: (m) => `🍽 She asked you to eat together (about ${m} min left)`,
    togetherAccept: 'Okay, let’s eat',
    togetherDecline: 'Not today',
    togetherEnd: 'Clear the table',
    togetherOwnerAte: 'you are eating',
    togetherNoDish: 'from your words',
    togetherBites: (n) => `${n} bites fed`,
    togetherBack: (n) => `She offered you a bite of ${n}`,
    togetherBackOk: 'Take it',
    togetherBackNo: 'Next time',
    togetherBackYes: 'taken',
    togetherBackNoDone: 'declined',
    togetherTakePh: 'I am eating… (one line is enough)',
    togetherTake: 'Note it',
    togetherTakeThis: 'I’m having this too',
    togetherBiteThis: 'Feed her a bite',
    togetherLastEnd: (why) => `Last meal: ${why}`,
    togetherEndWhyFinished: 'her share was finished',
    togetherEndWhyOwner: 'you called it',
    togetherEndWhyTtl: 'it sat too long',
    togetherEndWhyHer: 'she closed it',
    /* --- 今天（她的一天）面板 --- */
    dayNow: 'Right now',
    dayNowAt: (hm) => `${hm} now`,
    daySleeping: 'She is asleep',
    dayNothingNow: 'Nothing planned this minute',
    dayToday: 'Today',
    dayTomorrow: 'Tomorrow',
    dayPast: 'Earlier days',
    dayNoDay: 'She has not decided how to spend this day yet.',
    dayOff: 'Her day is switched off. Turn on lifeEnabled in config to start it.',
    dayAsk: 'Ask her to write tomorrow',
    dayAsking: 'Asked her…',
    dayAskAgain: 'Ask her to rethink it',
    dayAskAgainHint: 'Her version is only replaced if she actually writes a new one.',
    dayRewriteConfirm: 'She has already written tomorrow. Ask her to rewrite it? Only a new reply from her replaces the current one.',
    dayWaiting: 'Already waiting on her; a template fills in if she does not reply.',
    daySourceCoo: 'written by her',
    daySourceTemplate: 'stood in',
    daySourcePending: 'waiting for her',
    daySourceManual: 'adjusted',
    dayChange: 'Change of plan',
    dayChangePh: 'what she does (blank = skip it)',
    dayChangeGo: 'Change this block',
    dayChangeHint: 'Give a time range and an activity; leave the activity blank to skip that stretch instead. Whatever was planned there is trimmed or split. Hours that are already over cannot be changed — they are what happened. Clicking any row on the timeline fills it in here.',
    dayChangePicked: (s, e, a) => `Filled in ${s}–${e} ${a} — press “Change this block”.`,
    dayChanges: (n) => `adjusted ${n}×`,
    dayCount: (n) => `${n} blocks`,
    dayClickHint: 'Click to change this stretch',
    dayNoPast: 'Nothing here yet.',
    dayBack: '← Close',
    dayMeal: 'Meal',
    todayPlanTitle: 'Planned for now', todayActualTitle: 'What happened today', todayNextTitle: 'Up next',
    todayPlanDisclaimer: 'This is a plan, not a record of what happened.', todayActualEmpty: 'Nothing has been noted yet.',
    todayUpcoming: 'Coming up', todayPendingMeal: 'A meal is still waiting for her', todayTogetherInvite: 'She invited you to eat together', todayTogetherActive: 'You are eating together',
    todayDate: 'Date', todayMood: (m) => `Mood: ${m}`, todayWorking: 'Working today', todayNotWorking: 'Off today', todayWorkUnknown: 'Not scheduled yet',
    todayWorkReadError: 'Could not load today’s plans', todayWorkRetained: 'Future work scheduling is off. Today’s work plans are still on the schedule.', todayWorkAdjust: 'Adjust today',
    tomorrowWorkRetained: 'Future work scheduling is off. Tomorrow’s work plans are still on the schedule.',
    reminderMeal: 'Meal reminder', reminderFree: 'Free-time reminder', reminderOff: 'Reminders are off', reminderUnavailable: 'Could not load records',
    reminderMealPaused: 'She chose to skip meals today', reminderFreePaused: 'Paused for today', reminderUnconfigured: 'No times set', reminderFinished: 'No more slots today',
    reminderHer: 'Set by her', reminderConfig: 'From settings', reminderBusy: 'With the current plan, skipped if she’s busy',
    reminderAsleep: 'With the current plan, skipped if she’s asleep', reminderCheckIn: 'With the current plan, check-in only if she’s busy',
    reminderDue: 'Due; waiting for the next check', reminderCatchUp: 'Catch-up reminder due', reminderRetry: 'Repeat reminder due',
    reminderWaiting: 'This slot was sent; waiting for a response', reminderCatchUpSlot: 'catch-up',
    reminderFreeSkipped: (slot, doing) => `${slot === '补' ? 'Catch-up reminder' : slot} skipped · ${doing ? `Busy with ${doing}` : 'She was busy'}`,
    todayCategory: { sleep: 'Sleep', work: 'Work', commute: 'Commute', meal: 'Meal', personal: 'Personal' },
    todayTomorrowEmpty: 'Tomorrow has no plan yet.', todayTomorrowPending: 'She has been asked to write tomorrow; waiting for her reply.', todaySourceMissing: 'Not generated yet',
    todayTomorrowPendingAt: (s) => `Request sent at ${s}`, todayTomorrowRequestAt: (s) => `Request time: ${s}`, todayTomorrowUpdatedAt: (s) => `Updated: ${s}`, todayTomorrowSummary: 'Tomorrow summary', todayTomorrowNoActivities: 'No main activities yet.', homeLabel: 'Home', todayTomorrowCoo: 'Tomorrow’s plan was written by her.', todayTomorrowTemplate: 'Tomorrow is temporarily using the day template.',
    todayFreePlan: 'Ask her to think about the open time', todayFreePending: 'She has been asked to look at the open time.', todayFreeNone: 'There are no clearly open stretches today.',
    workCompareTitle: 'Confirm off work today', workBefore: 'Current schedule', workAfter: 'After switching off work', workNoChanges: 'No work or commute blocks were identified; only the work status will change.',
    workCancel: 'Cancel', workConfirm: 'Confirm change', workConflictNote: (n) => `${n} work blocks remain in the schedule.`, workUndo: 'Undo off-work change', workUndoing: 'Undoing…',
    todayPlanSendAt: (s) => `Request time: ${s}`, todayPlanUpdatedAt: (s) => `Updated: ${s}`, todayTimelineLabel: 'Category timeline', todayTimelineOpen: 'Expand full timeline', todayTimelineClose: 'Collapse full timeline', todayCategoryAuto: 'Automatic category', todayCategoryLabel: 'Activity category', workPreviewTitle: 'Original and free schedule', workPreviewCancel: 'Cancel', workPreviewConfirm: 'Confirm day off',
    workCategory: 'Work', sleepCategory: 'Sleep', commuteCategory: 'Commute', mealCategory: 'Meal', personalCategory: 'Personal',
    workActivity: 'Work', sleepActivity: 'Sleep', commuteActivity: 'Commute', mealActivity: 'Meal', personalActivity: 'Own time',
    workPreviewStale: 'This preview is out of date. Preview again before confirming.',
    todayActualMeal: 'Meal', todayActualActivity: 'Activity',
    todayStorage: 'Storage issues', todayReload: 'Reload', todayRestore: 'Restore from backup', todayRestoreConfirm: (n) => `Restore “${n}” from backup? This replaces the current contents.`,
    todayThreadTitle: 'Threads she left', todayThreadPh: 'Note an idea…', todayThreadAdd: 'Add note', todayThreadOwner: 'Noted by you', todayThreadCoo: 'Left by her', todayThreadDone: 'Done', todayThreadDrop: 'Drop', todayThreadDoneLabel: 'Done', todayThreadDropLabel: 'Dropped',
    todayPlanRetry: 'Resend request', todayPlanRetryConfirm: 'Tomorrow’s plan is still pending. Resend the request?',
    /* --- persistent work scheduling / today-only changes --- */
    workTitle: 'Working or not (ongoing schedule)', workOn: 'Work schedule on', workOff: 'Work schedule off',
    workPolicyEnabled: 'Ongoing work schedule: on', workPolicyDisabled: 'Ongoing work schedule: off',
    workPolicyHint: 'When disabled, work, overtime, and slacking-off day types all have weight 0 until re-enabled. Existing plans are not changed automatically; adjust them below if needed.',
    workPolicyError: 'The work-scheduling rule could not be loaded or saved. Switching is temporarily unavailable.', workPolicySaving: 'Saving…',
    workDailyTitle: 'Change today’s schedule only', workTodayOn: 'Work as planned today', workTodayOff: 'Off work today (today only)',
    workHint: 'This only changes today’s schedule, not the ongoing work rule. Turning work off previews the changes first; confirming removes work events while keeping other arrangements.',
    workNone: 'There is no schedule to change today. The ongoing work-schedule switch is still available.',
    mealByHer: 'Her own meal times',
    mealByConfig: 'Meal times from config',
    mealHerSlots: (s) => `she set ${s}`,
    mealDefaultSlots: (s) => `default slots ${s}`,
    /* --- free time --- */
    freeTitle: 'Her own time',
    freeOff: 'Free time is off.',
    freeDone: (n) => `${n} logged today`,
    freeNext: (hm) => `next ${hm}`,
    freeNone: 'no slots',
    freeSkipped: 'no scheduled wake-ups today (she can still do anything)',
    freeNotYet: 'Nothing logged yet (not logging does not stop her doing things).',
    freeHint: 'She is woken at these slots. The list is only examples — anything at all counts, and she may do as much or as little as she likes, starting whenever she wants without waiting for a wake-up. Never while the schedule says she is asleep; while she is at work it depends on the "Call her while she is busy" switch.',
    freeSkippedSlot: (doing) => `skipped: she was ${doing}`,
    freeSkippedHint: 'To reach her while she is busy too: config → "Her own time" → "Call her while she is busy".',
    freeSkipToday: 'No wake-ups today',
    freeSkipDone: 'Done — no more scheduled wake-ups today.',
    freeStart: 'Start something now',
    freeStartDone: 'Fine — she can do whatever she likes right now.',
  },
};

function tableFor(language) {
  return language === 'zh' || language === 'zh-Hant' ? TABLE.zh : TABLE.en;
}

/** 九维口味的条色，按维度固定，扫一眼就能认出这道菜往哪边走。 */
const TASTE_COLOR = {
  辣: '#e0533f',
  麻: '#a06be0',
  咸: '#6b7f99',
  鲜: '#3aa76d',
  甜: '#e07aa8',
  酸: '#d8a92c',
  苦: '#8a6a4f',
  油: '#c98a3c',
  香: '#3fa8a0',
};
const TASTE_ORDER = ['辣', '麻', '咸', '鲜', '甜', '酸', '苦', '油', '香'];

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = String(text);
  return node;
};

/** <option> 也一样用 document 建，别依赖全局 Option。 */
const option = (label, value) => {
  const o = document.createElement('option');
  o.textContent = label;
  o.value = value;
  return o;
};

function tasteRows(taste) {
  const wrap = el('div', 'feast-taste');
  for (const k of TASTE_ORDER) {
    const v = Number(taste?.[k] ?? 0);
    const row = el('div', 'feast-taste-row');
    row.appendChild(el('span', 'feast-taste-k', k));
    const bar = el('span', 'feast-taste-bar');
    const fill = el('i');
    fill.style.width = `${Math.max(0, Math.min(100, v))}%`;
    fill.style.background = TASTE_COLOR[k] ?? 'currentColor';
    bar.appendChild(fill);
    row.appendChild(bar);
    row.appendChild(el('span', 'feast-taste-v', v));
    wrap.appendChild(row);
  }
  return wrap;
}

function block(title, content) {
  const b = el('div', 'feast-block');
  b.appendChild(el('div', 'feast-block-t', title));
  if (typeof content === 'string') b.appendChild(el('div', 'feast-prose', content));
  else if (content) b.appendChild(content);
  return b;
}

function line(label, value) {
  const p = el('div', 'feast-line');
  p.appendChild(el('b', null, `${label}：`));
  p.appendChild(document.createTextNode(String(value ?? '')));
  return p;
}

// Browsing preferences are persisted; text drafts remain in this module session only.
const viewSessionMemory = new Map();
const viewFallbackScopes = new WeakMap();
let viewFallbackSequence = 0;
async function viewMemory(ctx, panelId) {
  let context = {};
  try { context = await ctx.invoke('viewState', []) || {}; } catch { /* old host: session-only fallback */ }
  const persistent = typeof context.scope === 'string' && /^[a-zA-Z0-9:_-]{8,160}$/.test(context.scope);
  let scope = context.scope;
  if (!persistent) {
    if (!viewFallbackScopes.has(ctx.root)) viewFallbackScopes.set(ctx.root, 'local-' + (++viewFallbackSequence));
    scope = viewFallbackScopes.get(ctx.root);
  }
  const key = 'fish-every-day.ui.v1.' + scope + '.' + panelId;
  let entry = viewSessionMemory.get(key);
  if (!entry) {
    let browse = {};
    if (persistent) try {
      const saved = JSON.parse(globalThis.localStorage?.getItem(key) || 'null');
      if (saved?.version === 1 && saved.browse && typeof saved.browse === 'object' && !Array.isArray(saved.browse)) browse = saved.browse;
    } catch { /* storage is optional and may be denied */ }
    entry = { browse, drafts: {} }; viewSessionMemory.set(key, entry);
  }
  return { get browse() { return entry.browse; }, drafts: entry.drafts, context,
    saveBrowse(value) {
      try {
        const encoded = JSON.stringify({ version: 1, browse: value });
        if (encoded.length > 16000) return;
        entry.browse = JSON.parse(encoded).browse;
        if (persistent) try { globalThis.localStorage?.setItem(key, encoded); } catch { /* keep session copy */ }
      } catch { /* browsing state must never interrupt a business action */ }
    },
  };
}
function viewScrollOwner(root, wrap) {
  const candidates = []; let node = wrap;
  for (let depth = 0; node && depth < 10; depth += 1) {
    if (!candidates.includes(node)) candidates.push(node);
    node = node.parentElement || node.parentNode || node.host || null;
  }
  if (root && !candidates.includes(root)) candidates.push(root);
  for (const candidate of candidates) {
    try {
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(candidate) : null;
      if (/(auto|scroll)/.test(style?.overflowY || '') && candidate.scrollHeight > candidate.clientHeight) return candidate;
    } catch { /* Document and ShadowRoot are not elements */ }
  }
  return candidates.find((candidate) => Number(candidate.scrollTop) > 0) || wrap || root;
}
function viewScrollTop(root, wrap) { return Math.max(0, Number(viewScrollOwner(root, wrap)?.scrollTop) || 0); }
function setViewScrollTop(root, wrap, value) {
  const owner = viewScrollOwner(root, wrap); if (owner) owner.scrollTop = Math.max(0, Number(value) || 0);
}
function replaceViewIsland(oldNode, nextNode) {
  if (!oldNode?.parentNode) return nextNode;
  if (typeof oldNode.replaceWith === 'function') oldNode.replaceWith(nextNode);
  else oldNode.parentNode.replaceChild(nextNode, oldNode);
  return nextNode;
}

/** 首屏一次画多少张卡；「再看 N 道」往上加。800 张全画是 8000 多个节点。 */
const MENU_PAGE = 60;

function toast(root, ctx, text, bad = false) {
  const old = root.querySelector('.feast-toast');
  if (old) old.remove();
  const node = el('div', `feast-toast${bad ? ' is-bad' : ''}`, text);
  node.setAttribute('role', bad ? 'alert' : 'status');
  node.setAttribute('aria-live', bad ? 'assertive' : 'polite');
  root.appendChild(node);
  if (!bad) ctx.timeout(() => node.remove(), 4000);
}

// ---------------------------------------------------------------------------
// 菜单面板
// ---------------------------------------------------------------------------

const menuPanel = {
  async mount(ctx) {
    const t = tableFor(ctx.language);
    const root = ctx.root;
    root.classList.add('feast');
    const style = el('style');
    style.textContent = CSS;
    root.appendChild(style);

    const memory = await viewMemory(ctx, 'menu');
    if (ctx.signal?.aborted) return { dispose() {} };
    const browse = memory.browse ?? {};
    const drafts = memory.drafts;
    const filter = {};
    for (const key of ['query', 'cuisine', 'category', 'quick']) {
      if (typeof browse.filter?.[key] === 'string') filter[key] = browse.filter[key];
    }
    const state = { filter, cuisines: [], categories: [], categoryCuisines: {}, detail: typeof browse.detailId === 'string' ? browse.detailId : null, pending: null, together: null, last: null, recommendations: null };
    let shownCount = Math.max(MENU_PAGE, Math.floor(Number(browse.shownCount) || MENU_PAGE));
    let listScroll = browse.listScroll && typeof browse.listScroll === 'object' ? { ...browse.listScroll } : {};
    let anchorDishId = typeof browse.anchorDishId === 'string' ? browse.anchorDishId : null;
    let disposed = false;
    let listSeq = 0;
    let detailSeq = 0;
    let recommendSeq = 0;
    let togetherSeq = 0;
    let searchTimer = null;
    let composing = false;
    let pendingBox = null;
    let togetherBox = null;
    const alive = () => !disposed && !ctx.signal?.aborted;
    const feedback = el('div', 'feast-note');
    const updating = el('div', 'feast-note');
    updating.setAttribute('role', 'status');
    root.appendChild(feedback);
    root.appendChild(updating);
    const wrap = el('div');
    const togetherHost = el('div');
    const view = el('div');
    wrap.appendChild(togetherHost);
    wrap.appendChild(view);
    root.appendChild(wrap);

    // 浏览位置可落盘；自由文字只留在共享会话对象里，回执也不写入 browse。
    function scrollOwner() {
      let node = root;
      while (node) {
        if (Number(node.scrollHeight) > Number(node.clientHeight) && Number(node.clientHeight) > 0) return node;
        node = node.parentNode;
      }
      return root;
    }
    function captureList() {
      if (state.detail) return;
      const owner = scrollOwner();
      listScroll = { top: viewScrollTop(root, wrap) };
      const cards = Array.from(view.querySelectorAll('.feast-card'));
      const top = owner.getBoundingClientRect?.().top ?? 0;
      const visible = cards.find((card) => (card.getBoundingClientRect?.().bottom ?? -1) > top);
      if (visible) {
        anchorDishId = visible.getAttribute('data-dish-id');
        listScroll.anchorOffset = (visible.getBoundingClientRect?.().top ?? top) - top;
      }
    }
    function persist() {
      const next = { filter: { ...state.filter }, shownCount, detailId: state.detail, listScroll: { ...listScroll }, anchorDishId };
      try { memory.saveBrowse(next)?.catch?.(() => {}); } catch { /* 浏览状态存储不可阻断菜单操作。 */ }
    }
    function restoreList(focusCard = false) {
      const card = Array.from(view.querySelectorAll('.feast-card')).find((node) => node.getAttribute('data-dish-id') === anchorDishId);
      if (focusCard && card) card.focus({ preventScroll: true });
      setViewScrollTop(root, wrap, Number(listScroll.top) || 0);
      const owner = scrollOwner();
      if (card && typeof listScroll.anchorOffset === 'number' && card.getBoundingClientRect && owner.getBoundingClientRect) {
        setViewScrollTop(root, wrap, viewScrollTop(root, wrap) + card.getBoundingClientRect().top - owner.getBoundingClientRect().top - listScroll.anchorOffset);
      }
    }
    function report(text, bad = false, retry = null) {
      if (!alive()) return;
      feedback.replaceChildren(el('span', null, text));
      feedback.setAttribute('role', bad ? 'alert' : 'status');
      feedback.className = bad ? 'feast-note is-bad' : 'feast-note';
      if (retry) {
        const button = el('button', null, t.uiRetry);
        button.onclick = async () => {
          if (!alive()) return;
          button.disabled = true;
          try {
            const ok = await retry();
            if (alive() && ok === true) report(t.sayOk);
          } finally { if (alive()) button.disabled = false; }
        };
        feedback.appendChild(button);
      }
    }
    function busy(value) {
      if (!alive()) return;
      updating.textContent = value ? t.uiUpdating : '';
      view.setAttribute('aria-busy', String(value));
    }
    let focusSave = null;
    let searchNode = null;
    let noteNode = null;
    let inviteNode = null;
    const saveFocus = () => {
      focusSave = null;
      const a = document.activeElement;
      if (a && (a === searchNode || a === noteNode || a === inviteNode)) {
        focusSave = { kind: a === noteNode ? 'note' : a === inviteNode ? 'invite' : 'search', start: a.selectionStart, end: a.selectionEnd };
      } else if (a?.getAttribute?.('data-dish-id')) {
        focusSave = { kind: 'card', id: a.getAttribute('data-dish-id') };
      }
    };
    const loadFocus = () => {
      const f = focusSave;
      focusSave = null;
      if (!f || !alive()) return;
      const node = f.kind === 'card' ? Array.from(view.querySelectorAll('.feast-card')).find((card) => card.getAttribute('data-dish-id') === f.id)
        : f.kind === 'note' ? noteNode : f.kind === 'invite' ? inviteNode : searchNode;
      if (!node) return;
      node.focus({ preventScroll: true });
      if (typeof f.start === 'number') {
        try { node.setSelectionRange(f.start, f.end); } catch { /* 非文字输入框无需恢复光标。 */ }
      }
    };

    /** 还剩几分钟（向上取整：不到一分钟也算"1 分钟"，别显示 0）。 */
    function remainMin(p) {
      const ttl = Number(p?.ttlMin) || 30;
      const at = Number(p?.at) || 0;
      const leftMs = at + ttl * 60_000 - Date.now();
      return leftMs <= 0 ? 0 : Math.ceil(leftMs / 60_000);
    }

    /** 写入与刷新分开判定：刷新失败不能把已完成的动作说成失败。 */
    async function act(method, args = [], button = null) {
      if (!alive() || button?.disabled) return false;
      const snapshot = args.map((arg) => arg && typeof arg === 'object' ? { ...arg } : arg);
      const draftKey = method === 'invite' ? 'inviteDraft' : method === 'take' && snapshot[0]?.note !== undefined ? 'noteDraft' : null;
      const submitted = draftKey ? drafts[draftKey] : null;
      if (button) button.disabled = true;
      let result;
      ++togetherSeq; // 使写入前发出的后台读失效。
      try {
        result = await ctx.invoke(method, snapshot);
        if (result?.ok !== true) {
          report(result?.message ?? t.sayNo, true);
          return false;
        }
      } catch (err) {
        report(t.failed(err?.message ?? err), true);
        return false;
      } finally {
        if (alive() && button) button.disabled = false;
      }
      // 只清本次确实提交过、且等待期间未继续编辑的那份草稿。
      if (draftKey && drafts[draftKey] === submitted) {
        drafts[draftKey] = '';
        if (alive()) {
          const node = draftKey === 'noteDraft' ? noteNode : inviteNode;
          if (node) node.value = '';
        }
      }
      if (!alive()) return true;
      if (result?.together) updateTogether(result.together);
      report(method === 'invite' ? t.uiInviteSent : result?.message ?? t.sayOk);
      const refreshed = await refreshTogether();
      if (alive() && !refreshed) report(t.uiSavedRefreshFailed, true, () => refreshTogether());
      return true;
    }

    /** 散桌的四种说法。 */
    function endWhy(why) {
      if (why === 'finished') return t.togetherEndWhyFinished;
      if (why === 'ttl') return t.togetherEndWhyTtl;
      if (why === 'her') return t.togetherEndWhyHer;
      return t.togetherEndWhyOwner;
    }

    /**
     * 一起吃饭那条。三种样子：正一起吃 / 她挂着邀请 / 都没有（只有一个小按钮）。
     *
     * 动作做完就整块重拉；但**自走表那一路只拉这一条、只改那几个字**（见 refreshTogether）：
     * 701 张卡每 30 秒重建一次既费，也会把搜索框的焦点和滚动位置弄丢。
     */
    function togetherBar(tg) {
      const box = el('div', 'feast-together');

      if (tg.active) {
        const head = el('div', 'feast-together-h');
        const title = el('b', null, `🍽 ${t.togetherNow(tg.elapsedMin)}`);
        head.appendChild(title);
        head.appendChild(el('span', 'feast-dim',
          tg.starter === 'her' ? t.togetherStartedByHer : t.togetherStartedByOwner));
        const end = el('button', null, t.togetherEnd);
        end.onclick = () => void act('end', [], end);
        head.appendChild(end);
        box.appendChild(head);
        togetherBox = { title, tg };

        for (const e of tg.ownerAte ?? []) {
          const what = e.kind === 'dish' ? e.name : e.note;
          box.appendChild(el('div', 'feast-together-row',
            `${t.togetherOwnerAte}：${what}${e.kind === 'note' ? `（${t.togetherNoDish}）` : ''}`));
        }
        if (tg.biteCount) {
          box.appendChild(el('div', 'feast-together-row',
            `${t.togetherBites(tg.biteCount)}：${(tg.bites ?? []).map((b) => b.name || b.id).join('、')}`));
        }

        // 主人自己也吃点什么：库内那道在菜品详情里点「我也吃这道」，这里写自由文本。
        const bar = el('div', 'feast-together-bar');
        const note = el('input', 'feast-search');
        note.placeholder = t.togetherTakePh;
        // 她那边一动（分了一口、先收了这顿）整条会重画：草稿存外面，重画带回来。
        note.value = drafts.noteDraft ?? '';
        note.oninput = () => { drafts.noteDraft = String(note.value ?? ''); };
        noteNode = note;
        bar.appendChild(note);
        const say = el('button', null, t.togetherTake);
        say.onclick = () => {
          const text = String(note.value ?? '').trim();
          void act('take', [{ note: text }], say);
        };
        bar.appendChild(say);
        box.appendChild(bar);

        for (const g of tg.back ?? []) {
          const row = el('div', 'feast-together-row');
          row.appendChild(el('span', null, t.togetherBack(g.name || g.id)));
          if (g.ok === null) {
            const yes = el('button', 'feast-btn-primary', t.togetherBackOk);
            yes.onclick = () => void act('reply', [{ ok: true }], yes);
            const no = el('button', null, t.togetherBackNo);
            no.onclick = () => void act('reply', [{ ok: false }], no);
            row.appendChild(yes);
            row.appendChild(no);
          } else {
            row.appendChild(el('span', 'feast-dim', g.ok ? t.togetherBackYes : t.togetherBackNoDone));
          }
          box.appendChild(row);
        }
        return box;
      }

      if (tg.invite) {
        const head = el('div', 'feast-together-h');
        const left = el('b', null, t.togetherHerAsk(tg.invite.leftMin));
        head.appendChild(left);
        box.appendChild(head);
        togetherBox = { invite: left, tg };

        const bar = el('div', 'feast-together-bar');
        const yes = el('button', 'feast-btn-primary', t.togetherAccept);
        yes.onclick = () => void act('accept', [], yes);
        const no = el('button', null, t.togetherDecline);
        no.onclick = () => void act('decline', [], no);
        bar.appendChild(yes);
        bar.appendChild(no);
        box.appendChild(bar);
        return box;
      }

      const bar = el('div', 'feast-together-bar');
      // 服务端 inviteTogether(note) 一直支持带一句话（会原样拼进推给她的事件），
      // 0.7.1 的面板却只调 act('invite')、不传 note——主人想先交代一句「今天有点累」没法说。
      // 用单独的 class（不叫 feast-search）：菜单面板顶上那个才是搜索框。
      const note = el('input', 'feast-invite-note');
      note.placeholder = t.togetherInvitePh;
      note.value = drafts.inviteDraft ?? '';
      note.oninput = () => { drafts.inviteDraft = String(note.value ?? ''); };
      inviteNode = note;
      const ask = el('button', null, t.togetherInvite);
      ask.onclick = () => {
        const said = String(note.value ?? '').trim();
        void act('invite', [said ? { note: said } : undefined], ask);
      };
      bar.appendChild(note);
      bar.appendChild(ask);
      if (tg.lastEnd) {
        bar.appendChild(el('span', 'feast-dim', t.togetherLastEnd(endWhy(tg.lastEnd.why))));
      }
      box.appendChild(bar);
      return box;
    }

    /** 会话条的"结构签名"：只有它变了才值得重画整块；分钟数变了只改那几个字。 */
    function togetherSig(v) {
      if (!v) return '';
      return JSON.stringify({
        active: v.active,
        at: v.at,
        invite: v.invite ? v.invite.at : 0,
        lastEnd: v.lastEnd ? v.lastEnd.at : 0,
        bites: [v.biteCount, v.bites ?? []],
        owner: v.ownerAte ?? [],
        back: (v.back ?? []).map((g) => [g.id, g.name, g.ok]),
      });
    }

    /** 后台读只更新所属条，详情、菜卡和列表滚动都保持原节点。 */
    function updateTogether(next) {
      if (!alive()) return;
      const changed = togetherSig(next) !== togetherSig(state.together) || !togetherHost.childNodes.length;
      state.together = next;
      if (changed) {
        saveFocus();
        togetherBox = null;
        noteNode = null;
        inviteNode = null;
        togetherHost.replaceChildren(...(next ? [togetherBar(next)] : []));
        loadFocus();
      } else {
        if (togetherBox?.title) togetherBox.title.textContent = `🍽 ${t.togetherNow(next.elapsedMin)}`;
        if (togetherBox?.invite && next.invite) togetherBox.invite.textContent = t.togetherHerAsk(next.invite.leftMin);
      }
    }
    async function refreshTogether() {
      if (!alive()) return false;
      const seq = ++togetherSeq;
      try {
        const result = await ctx.invoke('together', []);
        if (!alive() || seq !== togetherSeq) return false;
        if (result?.ok === false) return false;
        updateTogether(result?.together ?? null);
        return true;
      } catch { return false; }
    }

    function changeFilter() {
      clearTimeout(searchTimer);
      searchTimer = null;
      ++detailSeq;
      ++recommendSeq;
      state.detail = null;
      state.recommendations = null;
      shownCount = MENU_PAGE;
      listScroll = {};
      anchorDishId = null;
      persist();
      void load({ reset: true });
    }
    async function load(opts = {}) {
      if (!alive()) return false;
      const seq = ++listSeq;
      const filterSnapshot = { ...state.filter };
      const filterKey = JSON.stringify(filterSnapshot);
      const tgSeq = togetherSeq;
      busy(true);
      if (!state.last && !state.detail) view.replaceChildren(el('div', 'feast-empty', t.loading));
      try {
        const data = await ctx.invoke('list', [filterSnapshot]);
        if (!alive() || seq !== listSeq || filterKey !== JSON.stringify(state.filter)) return false;
        if (data?.ok === false || !Array.isArray(data?.items)) throw new Error(data?.message ?? t.sayNo);
        if (state.last && !state.detail && !opts.reset) captureList();
        state.cuisines = data.cuisines ?? [];
        state.categories = data.categories ?? [];
        state.categoryCuisines = data.categoryCuisines ?? {};
        state.pending = data.pending ?? null;
        if (tgSeq === togetherSeq) updateTogether(data.together ?? null);
        state.last = data;
        if (!state.detail && !composing) render(data, { focusCard: opts.focusCard });
        persist();
        return true;
      } catch (err) {
        if (!alive() || seq !== listSeq || filterKey !== JSON.stringify(state.filter)) return false;
        if (!state.last && !state.detail) view.replaceChildren(el('div', 'feast-empty is-bad', t.failed(err?.message ?? err)));
        if (opts.report !== false) report(`${t.uiRefreshFailed} ${t.failed(err?.message ?? err)}`, true, () => load());
        return false;
      } finally {
        if (alive() && seq === listSeq) busy(false);
      }
    }

    function render(data, opts = {}) {
      if (!alive() || state.detail) return;
      saveFocus();
      view.replaceChildren();
      pendingBox = null;
      searchNode = null;

      const wrap = view;
      // 工具条
      const bar = el('div', 'feast-bar');
      const search = el('input', 'feast-search');
      search.type = 'search';
      search.placeholder = t.search;
      search.value = state.filter.query ?? '';
      searchNode = search;
      const queueSearch = () => {
        if (!alive()) return;
        state.filter.query = String(search.value ?? '').trim();
        ++listSeq;
        ++recommendSeq;
        clearTimeout(searchTimer);
        persist();
        searchTimer = setTimeout(() => {
          searchTimer = null;
          if (alive() && !state.detail) changeFilter();
        }, 260);
      };
      search.oninput = (e) => {
        composing = !!e.isComposing;
        state.filter.query = String(search.value ?? '').trim();
        ++listSeq;
        ++recommendSeq;
        clearTimeout(searchTimer);
        persist();
        if (!composing) queueSearch();
      };
      search.addEventListener('compositionend', () => { composing = false; queueSearch(); });
      bar.appendChild(search);

      // 先形态，后菜系。菜系下拉跟着已选类别收窄——选了「汤羹」就不该再列「墨西哥菜」，
      // 那种选项按下去必然是空的。菜系轴上 0.3.0 起只有地域/传统，形态全在这边。
      const cat = el('select');
      cat.appendChild(option(t.allCats, ''));
      for (const c of state.categories) cat.appendChild(option(c, c));
      cat.value = state.filter.category ?? '';
      cat.onchange = () => {
        state.filter.category = cat.value;
        // 换类别后原来选的菜系可能已经不在这一类里了，直接清掉，别让她看到空结果。
        const allowed = state.filter.category
          ? (state.categoryCuisines[state.filter.category] ?? [])
          : state.cuisines;
        if (state.filter.cuisine && !allowed.includes(state.filter.cuisine)) state.filter.cuisine = '';
        cuisine.replaceChildren(option(t.allCuisines, ''), ...allowed.map((c) => option(c, c)));
        cuisine.value = state.filter.cuisine ?? '';
        changeFilter();
      };
      bar.appendChild(cat);

      const cuisine = el('select');
      cuisine.appendChild(option(t.allCuisines, ''));
      const pool = state.filter.category
        ? (state.categoryCuisines[state.filter.category] ?? [])
        : state.cuisines;
      for (const c of pool) cuisine.appendChild(option(c, c));
      cuisine.value = state.filter.cuisine ?? '';
      cuisine.onchange = () => {
        state.filter.cuisine = cuisine.value;
        changeFilter();
      };
      bar.appendChild(cuisine);

      const dice = el('button', 'feast-btn-primary', t.random);
      dice.onclick = async () => {
        if (!alive()) return;
        const seq = ++detailSeq;
        const snapshot = { ...state.filter };
        dice.disabled = true;
        try {
          const r = await ctx.invoke('random', [snapshot]);
          if (!alive() || seq !== detailSeq || JSON.stringify(snapshot) !== JSON.stringify(state.filter)) return;
          if (r?.ok && r.dish) void openDetail(r.dish.id);
          else report(r?.message ?? t.empty, true);
        } catch (err) {
          if (alive() && seq === detailSeq) report(t.failed(err?.message ?? err), true);
        } finally {
          if (alive()) dice.disabled = false;
        }
      };
      bar.appendChild(dice);
      wrap.appendChild(bar);

      const shortcuts = el('div', 'feast-menu-shortcuts');
      shortcuts.setAttribute('aria-label', t.quickAll);
      for (const [quick, label] of [['all', t.quickAll], ['liked', t.quickLiked], ['untried', t.quickUntried], ['recent', t.quickRecent]]) {
        const button = el('button', (state.filter.quick || 'all') === quick ? 'is-on' : null, label);
        button.setAttribute('aria-pressed', String((state.filter.quick || 'all') === quick));
        button.onclick = () => { state.filter.quick = quick; changeFilter(); };
        shortcuts.appendChild(button);
      }
      const discover = el('button', null, t.discover);
      discover.onclick = async () => {
        if (!alive()) return;
        const seq = ++recommendSeq;
        const snapshot = { ...state.filter };
        discover.disabled = true;
        busy(true);
        try {
          const result = await ctx.invoke('recommend', [snapshot]);
          if (!alive() || seq !== recommendSeq || state.detail || JSON.stringify(snapshot) !== JSON.stringify(state.filter)) return;
          if (result?.ok === false) throw new Error(result.message || t.sayNo);
          captureList();
          state.recommendations = (result.items ?? []).slice(0, 3);
          render(state.last);
        } catch (err) {
          if (alive() && seq === recommendSeq) report(t.failed(err?.message ?? err), true);
        } finally {
          if (alive() && seq === recommendSeq) { discover.disabled = false; busy(false); }
        }
      };
      shortcuts.appendChild(discover); wrap.appendChild(shortcuts);
      if (state.recommendations) {
        const picks = el('div', 'feast-block feast-discovery');
        picks.appendChild(el('div', 'feast-note', state.recommendations.length ? t.discoverHint : t.discoverEmpty));
        for (const dish of state.recommendations) {
          const choice = el('button', 'feast-chip', dish.name + ' · ' + dish.cuisine);
          choice.onclick = () => void openDetail(dish.id);
          picks.appendChild(choice);
        }
        wrap.appendChild(picks);
      }

      // 端过来还没吃的那道：右侧写着还剩多久，自己会走。端错了能就地收回来。
      if (state.pending) {
        const p = state.pending;
        const strip = el('div', 'feast-strip');
        strip.appendChild(el('b', null, `🍽 ${p.name ?? (p.isTable ? t.comboTable : '')}`));
        strip.appendChild(el('span', 'feast-dim', `${t.pending} · ${t.pendingHint}`));
        const left = el('span', 'feast-left', t.pendingLeft(remainMin(p)));
        const back = el('button', null, t.retract);
        back.onclick = async () => {
          if (!alive()) return;
          const name = p.name ?? '';
          back.disabled = true;
          try {
            const r = await ctx.invoke('retract', []);
            if (!alive()) return;
            if (!r?.ok) { report(r?.message ?? t.retractNone, true); return; }
            report(r.message ?? t.retracted(name));
          } catch (err) {
            report(t.failed(err?.message ?? err), true);
            return;
          } finally { if (alive()) back.disabled = false; }
          const refreshed = await load({ report: false });
          if (alive() && !refreshed) report(t.uiSavedRefreshFailed, true, () => load());
        };
        strip.appendChild(back);
        strip.appendChild(left);
        pendingBox = { el: left, p };
        wrap.appendChild(strip);
      }

      // 首屏只画前 MENU_PAGE 张：库已经 800 道，全画一次是 8000 多个节点，
      // 而主人一屏最多看十几张。剩下的按「再看 N 道」一批一批加，不重新拉数据。
      const total = data.items.length;
      const shown = Math.min(shownCount, total);
      wrap.appendChild(el('div', 'feast-count', data.matched < data.total
        ? t.matched(data.matched, data.total)
        : t.all(data.total)));

      if (!total) {
        wrap.appendChild(el('div', 'feast-empty', t.empty));
        loadFocus();
        restoreList(opts.focusCard);
        return;
      }

      const grid = el('div', 'feast-grid');
      for (const d of data.items.slice(0, shown)) {
        const card = el('button', 'feast-card');
        card.setAttribute('data-dish-id', d.id);
        card.id = `feast-menu-dish-${d.id}`;
        const h = el('div', 'feast-card-h');
        h.appendChild(el('span', 'feast-card-n', d.name));
        const meta = el('span', 'feast-card-m', `${d.cuisine}·${d.category}`);
        h.appendChild(meta);
        card.appendChild(h);
        card.appendChild(el('div', 'feast-card-m', [d.region, t.eatenTimes(d.eaten)].filter(Boolean).join(' · ')));
        if (d.serving) card.appendChild(el('div', 'feast-card-s', d.serving));
        const tags = el('div', 'feast-tags');
        for (const k of (d.keywords ?? []).slice(0, 4)) tags.appendChild(el('span', 'feast-tag', k));
        card.appendChild(tags);
        card.onclick = () => openDetail(d.id);
        grid.appendChild(card);
      }
      wrap.appendChild(grid);

      if (shown < total) {
        const moreBox = el('div', 'feast-act');
        const more = el('button', null, t.more(Math.min(MENU_PAGE, total - shown)));
        more.onclick = () => {
          captureList();
          shownCount = Math.min(total, shown + MENU_PAGE);
          persist();
          render(data);
        };
        moreBox.appendChild(more);
        moreBox.appendChild(el('span', 'feast-count', t.shownOf(shown, total)));
        wrap.appendChild(moreBox);
      }

      loadFocus();
      restoreList(opts.focusCard);
    }

    async function backToList(focusCard = true) {
      if (!alive()) return;
      ++detailSeq;
      state.detail = null;
      persist();
      busy(false);
      if (state.last) render(state.last, { focusCard });
      else await load({ focusCard });
    }
    async function openDetail(id, opts = {}) {
      if (!alive()) return false;
      const previousDetail = state.detail;
      const hadVisibleContent = Boolean(view.querySelector('.feast-detail') || view.querySelector('.feast-bar'));
      if (!state.detail) {
        captureList();
        anchorDishId = id;
        const card = Array.from(view.querySelectorAll('.feast-card')).find((node) => node.getAttribute('data-dish-id') === id);
        const owner = scrollOwner();
        if (card?.getBoundingClientRect) listScroll.anchorOffset = card.getBoundingClientRect().top - (owner.getBoundingClientRect?.().top ?? 0);
      }
      const seq = ++detailSeq;
      ++recommendSeq;
      clearTimeout(searchTimer);
      searchTimer = null;
      state.detail = id;
      persist();
      busy(true);
      if (!view.childNodes.length) view.replaceChildren(el('div', 'feast-empty', t.loading));
      let data;
      try {
        data = await ctx.invoke('dish', [id]);
        if (!alive() || seq !== detailSeq || state.detail !== id) return false;
        if (!data?.ok || !data.dish) throw new Error(data?.message ?? t.uiDetailFailed);
      } catch (err) {
        if (!alive() || seq !== detailSeq || state.detail !== id) return false;
        if (hadVisibleContent) {
          state.detail = previousDetail;
          persist();
        } else if (state.last) {
          state.detail = null;
          persist();
          render(state.last);
        } else {
          const escape = el('button', null, t.back);
          escape.onclick = () => void backToList();
          view.replaceChildren(escape, el('div', 'feast-empty is-bad', t.uiDetailFailed));
        }
        report(`${t.uiDetailFailed} ${t.failed(err?.message ?? err)}`, true, () => openDetail(id, opts));
        return false;
      } finally {
        if (alive() && seq === detailSeq) busy(false);
      }
      state.pending = data.pending ?? null;
      const d = data.dish;

      const box = el('div', 'feast-detail');
      const back = el('button', null, t.back);
      back.onclick = () => void backToList();
      box.appendChild(back);

      const head = el('div', 'feast-detail-h');
      const left = el('div');
      left.appendChild(el('div', 'feast-detail-n', d.name));
      left.appendChild(el('div', 'feast-detail-m',
        [d.alias, `${d.cuisine} · ${d.category}`, d.region, t.eatenTimes(d.eaten)].filter(Boolean).join(' · ')));
      head.appendChild(left);
      const serve = el('button', 'feast-btn-primary', t.serve);
      serve.onclick = async () => {
        if (!alive()) return;
        const dishId = d.id;
        const dishName = d.name;
        const detailToken = detailSeq;
        serve.disabled = true;
        serve.textContent = t.serving;
        let result;
        try {
          result = await ctx.invoke('feed', [dishId]);
          if (!result?.ok) { report(result?.message ?? t.sayNo, true); return; }
        } catch (err) {
          report(t.failed(err?.message ?? err), true);
          return;
        } finally {
          if (alive()) { serve.disabled = false; serve.textContent = t.serve; }
        }
        if (!alive()) return;
        state.pending = result.pending ?? null;
        report(t.uiServeWaiting(result.dish?.name ?? dishName));
        if (detailToken === detailSeq && state.detail === dishId) await backToList();
        const refreshed = await load({ report: false });
        if (alive() && !refreshed) report(t.uiSavedRefreshFailed, true, () => load());
      };
      head.appendChild(serve);
      // 正一起吃的时候，才谈得上"喂她一口"和"我也吃这道"——不在席上没这个上下文。
      if (state.together?.active) {
        const bite = el('button', null, t.togetherBiteThis);
        bite.onclick = () => void act('bite', [d.id], bite);
        head.appendChild(bite);

        const mine = el('button', null, t.togetherTakeThis);
        mine.onclick = () => void act('take', [{ id: d.id }], mine);
        head.appendChild(mine);
      }
      box.appendChild(head);

      if (d.serving) box.appendChild(block(t.servingLabel, d.serving));
      box.appendChild(block(t.taste, tasteRows(d.taste)));
      if (d.ingredients?.length) {
        const ing = el('div', 'feast-ing');
        for (const i of d.ingredients) ing.appendChild(el('span', null, i));
        box.appendChild(block(t.ingredients, ing));
      }
      if (d.method) box.appendChild(block(t.method, d.method));
      const senses = el('div');
      if (d.texture) senses.appendChild(line(t.texture, d.texture));
      if (d.aroma) senses.appendChild(line(t.aroma, d.aroma));
      if (d.finish) senses.appendChild(line(t.finish, d.finish));
      if (senses.childNodes.length) box.appendChild(block(`${t.texture} / ${t.aroma} / ${t.finish}`, senses));
      if (d.prose) box.appendChild(block(t.prose, d.prose));
      if (d.keywords?.length) {
        const tags = el('div', 'feast-tags');
        for (const k of d.keywords) tags.appendChild(el('span', 'feast-tag', k));
        box.appendChild(block(t.tags, tags));
      }
      if (!alive() || seq !== detailSeq || state.detail !== id) return false;
      pendingBox = null;
      searchNode = null;
      view.replaceChildren(box);
      return true;
    }

    const restoredDetail = state.detail;
    const restoreCardFocus = memory.drafts.menuVisited === true && !restoredDetail;
    memory.drafts.menuVisited = true;
    await load({ focusCard: restoreCardFocus });
    if (alive() && restoredDetail && state.detail === restoredDetail) await openDetail(restoredDetail, { restore: true });

    const ticker = alive() ? ctx.interval?.(() => {
      if (!alive()) return;
      if (pendingBox) {
        const left = remainMin(pendingBox.p);
        if (left > 0) pendingBox.el.textContent = t.pendingLeft(left);
        else {
          pendingBox.el.textContent = t.pendingGone;
          void load();
        }
      }
      void refreshTogether();
    }, 30_000) : null;

    return { dispose() {
      if (disposed) return;
      captureList();
      persist();
      disposed = true;
      ++listSeq;
      ++detailSeq;
      ++recommendSeq;
      ++togetherSeq;
      clearTimeout(searchTimer);
      searchTimer = null;
      ticker?.dispose?.();
    } };
  },
};

// ---------------------------------------------------------------------------
// 历史面板
// ---------------------------------------------------------------------------

const historyPanel = {
  async mount(ctx) {
    const t = tableFor(ctx.language);
    const root = ctx.root;
    if (ctx.signal?.aborted) return { dispose() {} };
    const firstLoad = el('div', 'feast-empty', t.loading);
    root.appendChild(firstLoad);
    const memory = await viewMemory(ctx, 'history');
    let disposed = false;
    let request = 0;
    let data = null;
    let savedScroll = Math.max(0, Number(memory.browse?.scrollTop) || 0);
    const alive = () => !disposed && !ctx.signal?.aborted;
    if (!alive()) return { dispose() {} };
    root.classList.add('feast');
    const style = el('style');
    style.textContent = CSS;
    root.appendChild(style);
    const status = el('div', 'feast-line');
    status.setAttribute('role', 'status');
    const wrap = el('div');
    root.appendChild(status);
    root.appendChild(wrap);
    firstLoad.remove();
    const scrollNodes = [wrap];
    for (let node = root; node && node !== document.body && node !== document.documentElement; node = node.parentElement ?? node.host) {
      if (typeof node.addEventListener === 'function') scrollNodes.push(node);
    }
    function keepScroll() {
      if (!data) return;
      savedScroll = viewScrollTop(root, wrap);
      memory.saveBrowse({ scrollTop: savedScroll });
    }
    function onScroll() { if (alive()) keepScroll(); }
    for (const node of scrollNodes) node.addEventListener('scroll', onScroll, { passive: true });
    function showStatus(message = '', bad = false) {
      if (!alive()) return;
      status.className = `feast-line${bad ? ' is-bad' : ''}`;
      status.replaceChildren();
      if (message) status.appendChild(el('span', null, message));
      if (bad) {
        const retry = el('button', null, t.uiRetry);
        retry.onclick = () => void load();
        status.appendChild(retry);
      }
    }
    async function load() {
      if (!alive()) return;
      const current = ++request;
      if (!data) wrap.replaceChildren(el('div', 'feast-empty', t.loading));
      showStatus(data ? t.uiUpdating : '');
      try {
        const next = await ctx.invoke('list', []);
        if (!alive() || current !== request) return;
        if (data) keepScroll();
        data = next;
        showStatus();
        render();
        setViewScrollTop(root, wrap, savedScroll);
      } catch {
        if (!alive() || current !== request) return;
        if (!data) wrap.replaceChildren();
        showStatus(t.uiRefreshFailed, true);
      }
    }
    function render() {
      if (!alive()) return;
      wrap.replaceChildren();
      const stats = el('div', 'feast-stats');
      // known is the server's full distinct count; top is capped to twelve rows.
      for (const [k, v] of [[t.statTotal, data.total], [t.statToday, data.today], [t.statKnown, data.known ?? 0]]) {
        const s = el('div', 'feast-stat');
        s.appendChild(el('div', 'feast-stat-v', v));
        s.appendChild(el('div', 'feast-stat-k', k));
        stats.appendChild(s);
      }
      wrap.appendChild(stats);
      const profile = el('div');
      if (data.profile?.avg) {
        profile.appendChild(tasteRows(data.profile.avg));
        for (const l of data.profile.lines ?? []) profile.appendChild(el('div', 'feast-line', l));
      } else {
        profile.appendChild(el('div', 'feast-line', t.noProfile));
      }
      wrap.appendChild(block(t.profile, profile));
      if (data.top?.length) {
        const list = el('div', 'feast-list');
        for (const item of data.top) {
          const row = el('div', 'feast-item');
          row.appendChild(el('span', 'feast-item-n', item.name));
          row.appendChild(el('span', 'feast-item-t', `×${item.n}`));
          list.appendChild(row);
        }
        wrap.appendChild(block(t.top, list));
      }
      if (data.recent?.length) {
        const list = el('div', 'feast-list');
        for (const e of data.recent) {
          const row = el('div', 'feast-item');
          const when = new Date(e.at);
          const hh = String(when.getHours()).padStart(2, '0');
          const mm = String(when.getMinutes()).padStart(2, '0');
          row.appendChild(el('span', 'feast-item-t', `${when.getMonth() + 1}/${when.getDate()} ${hh}:${mm}`));
          row.appendChild(el('span', 'feast-item-n', e.name));
          if (e.bite) row.appendChild(el('span', 'feast-flag is-owner', t.ownerBite));
          else if (e.by === 'owner') row.appendChild(el('span', 'feast-flag is-owner', t.owner));
          if (e.miss) row.appendChild(el('span', 'feast-flag', t.miss));
          list.appendChild(row);
        }
        wrap.appendChild(block(t.recent, list));
      }
      if (data.reactions?.length) {
        const list = el('div', 'feast-list');
        for (const r of data.reactions) {
          const row = el('div', 'feast-item');
          const word = r.liked === true ? t.like : r.liked === false ? t.dislike : t.ok;
          row.appendChild(el('span', 'feast-item-t', word));
          row.appendChild(el('span', 'feast-item-n', `${r.name || r.id}${r.note ? `——${r.note}` : ''}`));
          list.appendChild(row);
        }
        wrap.appendChild(block(t.reactions, list));
      }
    }
    function dispose() {
      if (disposed) return;
      keepScroll();
      disposed = true;
      request++;
      for (const node of scrollNodes) node.removeEventListener('scroll', onScroll);
      ctx.signal?.removeEventListener?.('abort', dispose);
    }
    ctx.signal?.addEventListener?.('abort', dispose, { once: true });
    await load();
    return { dispose };
  },
};

// ---------------------------------------------------------------------------
// 今天面板（她的一天）
// ---------------------------------------------------------------------------

/**
 * 她自己写下的这一天。
 *
 * 与别的面板不同，这一页是**读**为主：今天/明天的时间线、此刻落在哪一段、
 * 有几天往期。能动手的只有两处——请她写明天、临时改一段。
 *
 * 「此刻」不调 momentLine：那是给模型看的，末尾带着「不用特意跟主人汇报」。
 * 服务端 list 给的是 nowItem（当前那一段）和 nowMinute，这里自己拼句子。
 */
const todayPanel = {
  async mount(ctx) {
    const t = tableFor(ctx.language);
    const root = ctx.root;
    root.classList.add('feast');
    const style = el('style');
    style.textContent = CSS;
    root.appendChild(style);

    const navHost = el('div', 'feast-date-navigation'); root.appendChild(navHost);
    const viewStatus = el('div', 'feast-feedback feast-view-status'); viewStatus.setAttribute('role','status'); viewStatus.setAttribute('aria-live','polite'); root.appendChild(viewStatus);
    let wrap = el('div', 'feast-today-content'); root.appendChild(wrap);
    wrap.appendChild(el('div','feast-empty',t.loading));
    const memory = await viewMemory(ctx, 'today');
    const browse = memory.browse || {};
    const session = memory.drafts;
    let disposed = false; const alive = () => !disposed && !ctx.signal?.aborted;
    let requestSequence = 0, reviewSequence = 0, calendarSequence = 0;
    let currentReview = null, latestDate = memory.context.date || '', pendingDayData = null;
    let calendarOpen = false, calendarData = null, calendarLoading = false, calendarError = '';
    let lastNavigationSignature='';
    let calendarMonth = validViewDate((browse.month || '') + '-01') ? browse.month : '';
    let staging = false;
    let viewPainted = false;
    const changeDrafts = session.changeDrafts instanceof Map ? session.changeDrafts : new Map(); session.changeDrafts = changeDrafts;
    const positions = browse.positions && typeof browse.positions === 'object' ? {...browse.positions} : {};
    let changeInputDate = '';
    function notify(text, bad = false) { if (alive()) toast(root, ctx, text, bad); }
    function mark(node, key) { node.setAttribute('data-ux-island',key); return node; }
    function island(container,key) { return [...container.querySelectorAll('[data-ux-island]')].find((node)=>node.getAttribute('data-ux-island')===key) || null; }

    /** 面板数据（list 的整份回执）。 */
    let data = null;
    /** 正在看哪一天；null = 就用服务端给的今天。 */
    let viewing = browse.mode === 'history' && validViewDate(browse.date) ? browse.date : null;
    /** 「请她写明天」正在等回执，按钮别连点。 */
    let asking = false;
    /** 改主意表单里有没有没提交的草稿：有就说明人正在打字，别重画。 */
    let draftNode = null;
    const hasDraft = () => {
      const changeDraft = changeInputs && [changeInputs.startIn, changeInputs.endIn, changeInputs.actIn, changeInputs.categoryIn]
        .some((node) => node.value || node === document.activeElement);
      const threadInput = wrap.querySelector('input.feast-activity');
      const journalDraft = [...journalDrafts.values()].some((draft) => draft.titleDirty || draft.cardDirty || draft.selected.size);
      return Boolean(changeDraft || threadDraft || journalDraft || presetPreview || (threadInput && threadInput === document.activeElement));
    };

    /** 改主意表单的三个输入框，点时间线时往里填。 */
    let changeInputs = null;
    let threadDraft = typeof session.threadDraft === 'string' ? session.threadDraft : '';
    let operating = false;
    let todayTimelineOpen = browse.timelineOpen === true;
    let tomorrowTimelineOpen = browse.tomorrowOpen === true;
    let controlsOpen = browse.controlsOpen === true;
    let pastOpen = browse.pastOpen === true;
    let presetPreview = null;
    let presetMessage = '';
    let presetBad = false;
    let presetId = ['quiet','daily','lively'].includes(browse.presetId) ? browse.presetId : 'daily';
    const journalDrafts = session.journalDrafts instanceof Map ? session.journalDrafts : new Map(); session.journalDrafts = journalDrafts;
    for (const [date,draft] of journalDrafts) { draft.message=''; draft.bad=false; if(!(draft.selected instanceof Set))draft.selected=new Set(); }
    for (const [date,flags] of Object.entries(browse.journalViews || {})) {
      if (!validViewDate(date) || !flags || typeof flags !== 'object' || journalDrafts.has(date)) continue;
      journalDrafts.set(date,{title:'',cardTitle:'',titleDirty:false,cardDirty:false,selected:new Set(),message:'',bad:false,toolsOpen:flags.toolsOpen===true,recordsExpanded:flags.recordsExpanded===true,openCards:new Set(Array.isArray(flags.openCards)?flags.openCards.filter(id=>typeof id==='string').slice(0,12):[])});
    }
    const downloadUrls = new Set();
    const dateLabel = (v) => v?.sourceDate ?? v?.date ?? '';

    const sourceLabel = (s) => (s === 'coo' ? t.daySourceCoo
      : s === 'template' ? t.daySourceTemplate
        : s === 'pending' ? t.daySourcePending
          : s === 'manual' ? t.daySourceManual : '');
    // 睡觉判据跟服务端对齐：/睡/ 认不出「回笼觉」「打盹」。

    /** 'HH:MM' → 当天第几分钟；坏值给 null（时间线不该因为一行脏数据整页不画）。 */
    function minuteOf(hm) {
      const m = /^\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*$/.exec(String(hm ?? ''));
      if (!m) return null;
      const h = Number(m[1]);
      const mi = Number(m[2]);
      if (mi > 59 || h > 24 || (h === 24 && mi !== 0)) return null;
      return h * 60 + mi;
    }
    /** 服务端给的 nowMinute 只对「今天」有意义；看往期时不能高亮。 */
    const isToday = () => (viewing ?? data?.date) === data?.date;

    /**
     * 一天的时间线。now 给了就高亮落在 now 上的那一段、并把过去的压暗。
     *
     * `meals` 给了就在对应的段上标出饭点（服务端手上本来就有档位，以前只在顶上写一句话）；
     * `clickable` 为真时点一行会把起止和活动名填进「临时改主意」——以前那儿得手抄时间。
     */
    function timeline(day, now = null, opts = {}) {
      const list = el('div', 'feast-tl');
      const meals = opts.meals ?? [];
      const eatenMin = new Set((opts.eatenAt ?? []).map((at) => {
        // 吃过的那一刻落在哪一档：取档位里最近的、且在她吃之后的。
        const d = new Date(at);
        return d.getHours() * 60 + d.getMinutes();
      }));
      for (const it of day?.items ?? []) {
        const row = el('div', 'feast-tl-row');row.setAttribute('data-start',it.start);row.setAttribute('data-end',it.end);
        const category = ['sleep', 'work', 'commute', 'meal', 'personal'].includes(it.displayCategory) ? it.displayCategory : '';
        if (category) row.setAttribute('data-category', category);
        row.appendChild(el('span', 'feast-tl-dot'));
        row.appendChild(el('span', 'feast-tl-t', `${it.start}–${it.end}`));
        const mid = el('div', 'feast-tl-n');
        const where = it.scene || it.location;
        const activity = el('div', 'feast-tl-a');
        activity.appendChild(document.createTextNode(`${it.activity ?? ''}${where ? `（${where}）` : ''}`));
        if (category) activity.appendChild(el('span', 'feast-category', t.todayCategory[category]));
        mid.appendChild(activity);
        const bits = [];
        if (it.detail) bits.push(it.detail);
        if (it.outfit) bits.push(`穿着${it.outfit}`);
        if (it.props?.length) bits.push(`手边有${it.props.join('、')}`);
        if (it.with?.length) bits.push(`和${it.with.join('、')}`);
        if (bits.length) {
          const details = el('details', 'feast-tl-detail');
          details.appendChild(el('summary', null, category ? t.todayCategory[category] : (where || it.activity || '')));
          details.appendChild(el('div', 'feast-tl-d', bits.join('；')));
          details.addEventListener('click', (event) => event.stopPropagation());
          details.addEventListener('keydown', (event) => event.stopPropagation());
          mid.appendChild(details);
        }
        row.appendChild(mid);

        // 饭点标记：这一段时间里落进了哪一档，就在行尾挂一个小标。
        const s0 = minuteOf(it.start);
        const e0 = minuteOf(it.end);
        if (s0 !== null && e0 !== null) {
          for (const hm of meals) {
            const m = minuteOf(hm);
            if (m === null || m < s0 || m >= e0) continue;
            const did = eatenMin.has(m) || eatenMin.has(m + 1) || eatenMin.has(m - 1)
              || eatenMin.has(m + 2) || eatenMin.has(m - 2);
            row.appendChild(el('span', `feast-meal${did ? ' is-done' : ''}`,
              `${did ? '✓ ' : ''}${t.dayMeal} ${hm}`));
          }
        }

        if (now !== null) {
          const s = minuteOf(it.start);
          const e = minuteOf(it.end);
          if (s !== null && e !== null) {
            if (s <= now && now < e) row.classList.add('is-now');
            else if (e <= now) row.classList.add('is-past');
          }
        }
        if (opts.clickable && it.start && it.end) {
          row.classList.add('is-click');
          row.title = t.dayClickHint;
          row.tabIndex = 0;
          row.setAttribute('role', 'button');
          row.onclick = () => fillChange(it);
          row.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fillChange(it); }
          });
        }
        list.appendChild(row);
      }
      return list;
    }

    /** 点时间线某一段：把起止和活动名填进「临时改主意」，并滚过去。 */
    function fillChange(it) {
      if (!changeInputs) return;
      const { startIn, endIn, actIn } = changeInputs;
      startIn.value = String(it.start ?? '');
      endIn.value = String(it.end ?? '');
      actIn.value = String(it.activity ?? '');
      if (changeInputs.categoryIn) changeInputs.categoryIn.value = String(it.category ?? '');
      draftNode = actIn;
      draftNode.value = actIn.value; // 有草稿就别让走表重画把人打断
      notify(t.dayChangePicked(it.start, it.end, it.activity));
      controlsOpen = true; const controls = wrap.querySelector('.feast-management'); if (controls) controls.open = true;
      const box = changeInputs.box;
      if (box?.scrollIntoView) {
        try { box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* 老宿主没有就算了 */ }
      }
      try { actIn.focus(); } catch { /* 同上 */ }
    }

    /** 一天的头：日期、日型、她写的标题与心情、来源。 */
    function dayHead(day, label) {
      const head = el('div', 'feast-day');
      head.appendChild(el('b', null, label));
      head.appendChild(el('span', 'feast-dim', day?.dayType?.name ?? ''));
      if (day?.title) head.appendChild(el('span', null, `——${day.title}`));
      if (day?.mood) head.appendChild(el('span', 'feast-dim', `心情：${day.mood}`));
      const src = sourceLabel(day?.source);
      if (src) head.appendChild(el('span', 'feast-flag', src));
      if (day?.changes?.length) head.appendChild(el('span', 'feast-flag', t.dayChanges(day.changes.length)));
      return head;
    }

    /** Persistent work-policy switch plus the existing, date-scoped preview/undo controls. */
    let workPreview = null;
    let workPreviewDate = null;
    let workDailyOpen = browse.workDailyOpen === true;
    async function setWork(on, button, revision = null) {
      button.disabled = true; operating = true;
      try {
        const r = await ctx.invoke('work', [{ date: data.date, work: on, ...(revision ? { revision } : {}) }]);
        if (r?.ok === false) { notify(r.message ?? t.sayNo, true); workPreview = null; workPreviewDate = null; }
        else { workPreview = null; workPreviewDate = null; notify(r?.message ?? t.sayOk); await refresh({saved:true}); }
      } catch (err) { workPreview = null; workPreviewDate = null; notify(t.failed(err?.message ?? err), true); }
      finally { operating = false; render(); }
    }
    async function previewWork(button) {
      if (workPreview) return;
      button.disabled = true; operating = true;
      try {
        const r = await ctx.invoke('work', [{ date: data.date, work: false, action: 'preview' }]);
        if (r?.ok === false) throw new Error(r.message ?? t.sayNo);
        workPreview = r; workPreviewDate = data.date;
      } catch (err) { notify(t.failed(err?.message ?? err), true); }
      finally { operating = false; render(); }
    }
    async function setWorkScheduling(enabled, button) {
      if (operating || data.workSchedulingError || typeof data.workSchedulingEnabled !== 'boolean') return;
      button.disabled = true; operating = true;
      try {
        const r = await ctx.invoke('workPolicy', [{ enabled }]);
        if (r?.ok === false) notify(r.message ?? t.sayNo, true);
        else notify(r?.message ?? t.sayOk);
        await refresh();
      } catch (err) {
        notify(t.failed(err?.message ?? err), true);
        await refresh();
      } finally { operating = false; render(); }
    }

    function workSection() {
      if (!data?.enabled) return el('div');
      const box = mark(el('div', 'feast-block'),'work');
      box.appendChild(el('div', 'feast-block-t', t.workTitle));

      const scheduleError = Boolean(data.workSchedulingError) || typeof data.workSchedulingEnabled !== 'boolean';
      const policyRow = el('div', 'feast-act');
      const onBtn = el('button', data.workSchedulingEnabled === true ? 'feast-btn-primary' : null, t.workOn);
      const offBtn = el('button', data.workSchedulingEnabled === false ? 'feast-btn-primary' : null, t.workOff);
      onBtn.disabled = operating || scheduleError || data.workSchedulingEnabled === true;
      offBtn.disabled = operating || scheduleError || data.workSchedulingEnabled === false;
      onBtn.onclick = () => void setWorkScheduling(true, onBtn);
      offBtn.onclick = () => void setWorkScheduling(false, offBtn);
      policyRow.appendChild(onBtn); policyRow.appendChild(offBtn);
      box.appendChild(policyRow);
      const statusText = scheduleError ? t.workPolicyError
        : data.workSchedulingEnabled ? t.workPolicyEnabled : t.workPolicyDisabled;
      box.appendChild(el('div', scheduleError ? 'feast-note is-bad' : 'feast-note', statusText));
      box.appendChild(el('div', 'feast-note', t.workPolicyHint));

      const daily = el('details', 'feast-work-daily');
      daily.open = Boolean(workDailyOpen || workPreview);
      daily.addEventListener('toggle', () => { if(staging||!root.contains(daily))return;workDailyOpen=daily.open;rememberView(); });
      const dailySummary = el('summary', null, t.workDailyTitle);
      daily.appendChild(dailySummary);
      if (!scheduleError && data.workSchedulingEnabled === false && data.retainedWork?.today) {
        const notice = el('div', 'feast-act feast-work-retained');
        notice.appendChild(el('span', null, t.todayWorkRetained));
        const adjust = el('button', null, t.todayWorkAdjust);
        adjust.onclick = () => {
          daily.open = workDailyOpen = true;
          dailySummary.focus();
        };
        notice.appendChild(adjust);
        box.appendChild(notice);
      }
      const day = data.today;
      const ready = Boolean(day?.items?.length) && day.source !== 'pending';
      if (!ready) {
        daily.appendChild(el('div', 'feast-empty', t.workNone));
      } else {
        const row = el('div', 'feast-act');
        const todayOn = el('button', data.work ? 'feast-btn-primary' : null, t.workTodayOn);
        const todayOff = el('button', !data.work ? 'feast-btn-primary' : null, t.workTodayOff);
        todayOn.disabled = operating || scheduleError || data.workSchedulingEnabled === false || data.work === true;
        todayOff.disabled = operating || scheduleError || (data.work === false && !data.workConflicts?.length);
        todayOn.onclick = () => void setWork(true, todayOn);
        todayOff.onclick = () => void previewWork(todayOff);
        row.appendChild(todayOn); row.appendChild(todayOff);
        daily.appendChild(row);
        daily.appendChild(el('div', 'feast-note', t.workHint));
        if (data.workConflicts?.length) daily.appendChild(el('div', 'feast-note', t.workConflictNote(data.workConflicts.length)));
        if (data.workUndoAvailable) {
          const undo = el('button', 'feast-btn', t.workUndo);
          undo.disabled = operating || data.workSchedulingEnabled === false || scheduleError;
          undo.onclick = async () => {
            undo.disabled = true;
            try {
              const r = await ctx.invoke('work', [{ date: data.date, action: 'undo' }]);
              notify(r?.message ?? t.sayOk, r?.ok === false);
              await refresh();
            } catch (err) { notify(t.failed(err?.message ?? err), true); undo.disabled = false; }
          };
          daily.appendChild(undo);
        }
      }

      if (workPreview) {
        const panel = el('div', 'feast-work-preview');
        panel.appendChild(el('b', null, t.workPreviewTitle));
        const compare = el('div', 'feast-work-compare');
        const affected = workPreview.affected ?? [];
        const personalAfter = affected.map((item) => ({ ...item, activity: t.personalActivity, location: t.homeLabel, scene: '' }));
        for (const [label, items, showLocation] of [[t.workBefore, affected, true], [t.workAfter, personalAfter, false]]) {
          const side = el('div', 'feast-work-side'); side.appendChild(el('b', null, label));
          const ul = el('ul');
          if (!items.length) ul.appendChild(el('li', null, t.workNoChanges));
          for (const item of items) ul.appendChild(el('li', null, `${item.start}–${item.end} ${item.activity ?? ''}${showLocation && item.location ? `（${item.location}）` : ''}${!showLocation ? `（${t.homeLabel}）` : ''}`));
          side.appendChild(ul); compare.appendChild(side);
        }
        panel.appendChild(compare);
        const actions = el('div', 'feast-work-actions');
        const cancel = el('button', null, t.workPreviewCancel); cancel.onclick = () => { workPreview = null; workPreviewDate = null; render(); };
        const confirm = el('button', 'feast-btn-primary', t.workPreviewConfirm);
        confirm.disabled = operating;
        confirm.onclick = () => {
          if (!workPreview?.revision) { workPreview = null; notify(t.workPreviewStale, true); render(); return; }
          void setWork(false, confirm, workPreview.revision);
        };
        actions.appendChild(cancel); actions.appendChild(confirm); panel.appendChild(actions); daily.appendChild(panel);
      }
      box.appendChild(daily);

      // Meal times are informational and remain visible outside the collapsed day-only editor.
      const slots = data.mealSlots ?? [];
      if (slots.length) {
        const line = el('div', 'feast-day');
        line.appendChild(el('span', 'feast-flag', data.mealSlotsByHer ? t.mealByHer : t.mealByConfig));
        line.appendChild(el('span', 'feast-dim',
          data.mealSlotsByHer ? t.mealHerSlots(slots.join('、')) : t.mealDefaultSlots(slots.join('、'))));
        box.appendChild(line);
      }
      return box;
    }

    function nowStrip() {
      const box = el('div', 'feast-strip');
      box.appendChild(el('b', null, t.dayNow));
      const it = data?.nowItem;
      if (!data?.enabled) {
        box.appendChild(el('span', 'feast-dim', t.dayOff));
        return box;
      }
      if (!it) {
        box.appendChild(el('span', 'feast-dim', t.dayNothingNow));
      } else if (data?.nowKind === 'asleep') {
        box.appendChild(el('span', null, t.daySleeping));
        box.appendChild(el('span', 'feast-dim', `${it.start}–${it.end}`));
      } else {
        const where = it.scene || it.location;
        box.appendChild(el('span', null, `${it.activity}${where ? `（${where}）` : ''}`));
        box.appendChild(el('span', 'feast-dim', `${it.start}–${it.end}`));
      }
      if (data?.nowHm) box.appendChild(el('span', 'feast-left', t.dayNowAt(data.nowHm)));
      return box;
    }

    /** 一句话的空日程说明，别让面板只剩一片白。 */
    function emptyDay(text) {
      const list = el('div', 'feast-list');
      list.appendChild(el('div', 'feast-empty', text));
      return list;
    }

    function daySection(label, day, now, opts = {}) {
      const box = el('div');
      box.appendChild(dayHead(day, label));
      box.appendChild(day?.items?.length ? timeline(day, now, opts) : emptyDay(t.dayNoDay));
      return box;
    }

    /** 临时改主意的表单：起止时间 + 做什么。点时间线会自动填进来。 */
    function changeForm(date) {
      const box = el('div', 'feast-block');
      box.appendChild(el('div', 'feast-block-t', t.dayChange));
      const form = el('div', 'feast-form');
      const startIn = el('input', 'feast-time');
      startIn.placeholder = '20:00';
      startIn.value = '';
      const endIn = el('input', 'feast-time');
      endIn.placeholder = '21:30';
      endIn.value = '';
      const actIn = el('input', 'feast-activity');
      actIn.placeholder = t.dayChangePh;
      actIn.value = '';
      const categoryIn = el('select');
      categoryIn.setAttribute('aria-label', t.todayCategoryLabel);
      categoryIn.addEventListener('change', () => { draftNode = categoryIn; });
      categoryIn.appendChild(option(t.todayCategoryAuto, ''));
      for (const key of ['sleep', 'work', 'commute', 'meal', 'personal']) categoryIn.appendChild(option(t.todayCategory[key], key));
      categoryIn.value = '';
      actIn.addEventListener('input', () => { draftNode = actIn; });
      startIn.addEventListener('input', () => { draftNode = startIn; });
      endIn.addEventListener('input', () => { draftNode = endIn; });
      draftNode = actIn;
      changeInputs = { box, startIn, endIn, actIn, categoryIn }; changeInputDate = date;
      const go = el('button', 'feast-btn-primary', t.dayChangeGo);
      form.appendChild(startIn);
      form.appendChild(el('span', 'feast-dim', '–'));
      form.appendChild(endIn);
      form.appendChild(actIn);
      form.appendChild(categoryIn);
      form.appendChild(go);
      box.appendChild(form);
      box.appendChild(el('div', 'feast-note', t.dayChangeHint));

      go.onclick = async () => {
        const start = String(startIn.value ?? '').trim();
        const end = String(endIn.value ?? '').trim();
        const activity = String(actIn.value ?? '').trim();
        go.disabled = true;
        try {
          const r = await ctx.invoke('adjust', [{ date, start, end, activity, category: categoryIn.value }]);
          if (r?.ok) {
            notify(r.message ?? t.sayOk);
            await refresh();
          } else {
            notify(r?.message ?? t.sayNo, true);
            go.disabled = false;
          }
        } catch (err) {
          notify(t.failed(err?.message ?? err), true);
          go.disabled = false;
        }
      };
      return box;
    }

    /** 她自己的时间：今天记了几件、下一档几点、她刚做了什么。 */
    function freeSection() {
      const f = data?.free;
      if (!f) return null;
      const box = el('div', 'feast-block');
      box.appendChild(el('div', 'feast-block-t', t.freeTitle));

      const head = el('div', 'feast-day');
      if (!f.enabled) {
        head.appendChild(el('span', 'feast-dim', t.freeOff));
      } else if (f.skipped) {
        head.appendChild(el('span', 'feast-dim', t.freeSkipped));
      } else {
        head.appendChild(el('b', null, t.freeDone(f.done.length)));
        if (f.next) head.appendChild(el('span', 'feast-left', f.next === '没排档' || !f.slots.length ? t.freeNone : t.freeNext(f.next)));
      }
      box.appendChild(head);

      if (f.done.length) {
        const list = el('div', 'feast-list');
        for (const d of f.done) {
          const row = el('div', 'feast-item');
          // 时刻只写本地 HH:MM：服务端给的是毫秒，面板自己截。
          const when = new Date(d.at);
          const hh = String(when.getHours()).padStart(2, '0');
          const mm = String(when.getMinutes()).padStart(2, '0');
          row.appendChild(el('span', 'feast-item-t', `${hh}:${mm}`));
          row.appendChild(el('span', 'feast-item-n', `${d.activity}${d.note ? `——${d.note}` : ''}`));
          list.appendChild(row);
        }
        box.appendChild(list);
      } else if (f.enabled && !f.skipped) {
        box.appendChild(el('div', 'feast-empty', t.freeNotYet));
      }

      // 到点了、但日程说她被占着所以没叫的那几档。不写出来，面板上就只剩「今天没有了」，
      // 用户以为功能坏了（0.7.1 就是这样，实测她一天 13 段里 11 段都被判成"不算"）。
      // 0.8.0：忙时叫不叫由「忙着的时候也叫」决定，所以这栏现在是唯一会出现的沉默。
      if (f.skippedSlots?.length) {
        const list = el('div', 'feast-list');
        for (const s of f.skippedSlots) {
          const row = el('div', 'feast-item');
          row.appendChild(el('span', 'feast-item-t', s.slot));
          row.appendChild(el('span', 'feast-item-n', t.freeSkippedSlot(s.doing)));
          list.appendChild(row);
        }
        box.appendChild(list);
        if (!f.busyCall) box.appendChild(el('div', 'feast-note', t.freeSkippedHint));
      }
      // 面板上替她开口：0.7.1 只有一个「今天不叫了」是工具，主人点不到。
      if (f.enabled && !f.skipped) {
        const acts = el('div', 'feast-act');
        const skip = el('button', null, t.freeSkipToday);
        skip.onclick = async () => {
          skip.disabled = true;
          try {
            const r = await ctx.invoke('freeSkip', []);
            if (r?.ok) notify(r.message ?? t.freeSkipDone);
            else notify(r?.message ?? t.sayNo, true);
          } catch (err) {
            notify(t.failed(err?.message ?? err), true);
          } finally {
            await refresh();
          }
        };
        const start = el('button', null, t.freeStart);
        start.onclick = async () => {
          start.disabled = true;
          try {
            const r = await ctx.invoke('freeStart', []);
            if (r?.ok) notify(r.message ?? t.freeStartDone);
            else notify(r?.message ?? t.sayNo, true);
          } catch (err) {
            notify(t.failed(err?.message ?? err), true);
          } finally {
            start.disabled = false;
            await refresh();
          }
        };
        acts.appendChild(start);
        acts.appendChild(skip);
        box.appendChild(acts);
      }

      box.appendChild(el('div', 'feast-note', t.freeHint));
      return box;
    }

    function storageSection() {
      const issues = data?.storageIssues ?? [];
      if (!issues.length) return null;
      const box = el('div', 'feast-block');
      box.appendChild(el('div', 'feast-block-t', t.todayStorage));
      for (const issue of issues) {
        const row = el('div', 'feast-item');
        row.appendChild(el('span', 'feast-item-n', `${issue.label}: ${issue.message}`));
        const reload = el('button', null, t.todayReload);
        reload.disabled = operating;
        reload.onclick = () => void recovery(issue, 'reload');
        row.appendChild(reload);
        if (issue.backupAvailable) {
          const restore = el('button', null, t.todayRestore);
          restore.disabled = operating;
          restore.onclick = () => { if (window.confirm(t.todayRestoreConfirm(issue.label))) void recovery(issue, 'restore'); };
          row.appendChild(restore);
        }
        box.appendChild(row);
      }
      return box;
    }

    async function recovery(issue, action) {
      if (operating) return;
      operating = true;
      try {
        const r = await ctx.invoke('recovery', [{ key: issue.key, action }]);
        operating = false;
        if (r?.ok === false) notify(r.message ?? t.sayNo, true);
        else await refresh();
      } catch (err) { notify(t.failed(err?.message ?? err), true); }
      finally { operating = false; }
    }

    function threadsSection() {
      const items = data?.threads?.items ?? [];
      const box = mark(el('div', 'feast-block'), 'threads');
      box.appendChild(el('div', 'feast-block-t', t.todayThreadTitle));
      const list = mark(el('div', 'feast-list'), 'thread-list');
      for (const thread of items) {
        if (thread.status !== 'active' && thread.status !== 'done' && thread.status !== 'dropped') continue;
        const row = el('div', 'feast-item');
        row.appendChild(el('span', 'feast-item-t', dateLabel(thread)));
        row.appendChild(el('span', 'feast-item-n', `${thread.source === 'coo' ? t.todayThreadCoo : t.todayThreadOwner}: ${thread.text}${thread.sourceActivity ? ` · ${thread.sourceActivity}` : ''}`));
        if (thread.status === 'active') {
          const done = el('button', null, t.todayThreadDone);
          done.disabled = operating;
          done.onclick = () => void threadAction({ id: thread.id, status: 'done' });
          const drop = el('button', null, t.todayThreadDrop);
          drop.disabled = operating;
          drop.onclick = () => void threadAction({ id: thread.id, status: 'dropped' });
          row.appendChild(done); row.appendChild(drop);
        } else row.appendChild(el('span', 'feast-flag', thread.status === 'done' ? t.todayThreadDoneLabel : t.todayThreadDropLabel));
        list.appendChild(row);
      }
      box.appendChild(list);
      const form = el('div', 'feast-form feast-thread-form');
      const input = el('input', 'feast-activity');
      input.placeholder = t.todayThreadPh;
      input.maxLength = 120;
      input.value = threadDraft;
      input.oninput = () => { threadDraft = String(input.value ?? ''); draftNode = input; };
      draftNode = input;
      const add = el('button', 'feast-btn-primary', t.todayThreadAdd);
      add.disabled = operating;
      add.onclick = () => { const text = threadDraft.trim(); if (text) void threadAction({ text }); };
      form.appendChild(input); form.appendChild(add); box.appendChild(form);
      return box;
    }

    async function threadAction(payload) {
      if (operating) return;
      operating = true;
      try {
        const r = await ctx.invoke('thread', [payload]);
        operating = false;
        if (r?.ok === false) notify(r.message ?? t.sayNo, true);
        else { if (Object.hasOwn(payload, 'text')) threadDraft = ''; await refresh(); }
      } catch (err) { notify(t.failed(err?.message ?? err), true); }
      finally { operating = false; }
    }

    function pastSection() {
      const box = el('div');
      box.appendChild(el('div', 'feast-combo-h', t.dayPast));
      const days = (data?.recent ?? []).filter((d) => d.date < data?.date);
      if (!days.length) {
        box.appendChild(el('div', 'feast-empty', t.dayNoPast));
        return box;
      }
      const list = el('div', 'feast-list');
      for (const d of days) {
        const row = el('div', 'feast-item is-click');
        const [, mo, dd] = String(d.date ?? '').split('-');
        row.appendChild(el('span', 'feast-item-t', mo && dd ? `${Number(mo)}/${Number(dd)}` : d.date));
        row.appendChild(el('span', 'feast-item-n',
          `${d.dayType || ''}${d.title ? ` · ${d.title}` : ''}`));
        const src = sourceLabel(d.source);
        if (src) row.appendChild(el('span', 'feast-flag', src));
        row.appendChild(el('span', 'feast-item-t', t.dayCount(d.count ?? 0)));
        row.tabIndex = 0; row.setAttribute('role', 'button');
        row.onclick = async () => { await openDay(d.date); };
        row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void openDay(d.date); } });
        list.appendChild(row);
      }
      box.appendChild(list);
      return box;
    }

    function validViewDate(value) {
      if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000-'))return false;
      const time=Date.parse(value+'T12:00:00Z');return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
    }
    function shiftDate(value, amount) { const date=new Date(value+'T12:00:00Z'); date.setUTCDate(date.getUTCDate()+amount); return date.toISOString().slice(0,10); }
    function shiftMonth(value, amount) { const date=new Date(value+'-01T12:00:00Z'); date.setUTCMonth(date.getUTCMonth()+amount); return date.toISOString().slice(0,7); }
    function viewKey(){return viewing||'today';}
    function stashCurrent() {
      if(staging||!viewPainted)return;
      if(data)positions[viewKey()]=viewScrollTop(root,wrap);
      if(changeInputs&&changeInputDate)changeDrafts.set(changeInputDate,{start:changeInputs.startIn.value,end:changeInputs.endIn.value,activity:changeInputs.actIn.value,category:changeInputs.categoryIn.value});
      session.threadDraft=threadDraft;
    }
    function rememberView() {
      if(staging||!alive()||!viewPainted)return;
      stashCurrent();
      const safePositions={};for(const [key,value]of Object.entries(positions).slice(-14))if((key==='today'||validViewDate(key))&&Number.isFinite(Number(value)))safePositions[key]=Math.max(0,Math.min(1e7,Number(value)));
      const journalViews={};for(const [date,draft]of [...journalDrafts.entries()].slice(-12))if(validViewDate(date))journalViews[date]={toolsOpen:draft.toolsOpen===true,recordsExpanded:draft.recordsExpanded===true,openCards:[...(draft.openCards||[])].slice(0,12)};
      memory.saveBrowse({mode:viewing?'history':'today',date:viewing||'today',month:calendarMonth,positions:safePositions,timelineOpen:todayTimelineOpen,tomorrowOpen:tomorrowTimelineOpen,controlsOpen,pastOpen,workDailyOpen,presetId,journalViews});
    }
    function setViewStatus(message='',bad=false,retry=null) {
      if(!alive())return;
      viewStatus.className='feast-feedback feast-view-status'+(bad?' is-bad':'');viewStatus.setAttribute('role',bad?'alert':'status');viewStatus.replaceChildren();
      if(message)viewStatus.appendChild(document.createTextNode(message));
      if(retry){const button=el('button',null,t.uiRetry);button.onclick=()=>void retry();viewStatus.appendChild(button);}
    }
    function renderDateNavigation() {
      if(!alive()||staging)return;
      const selected=viewing||data?.date||latestDate;if(!validViewDate(selected))return;
      const signature=JSON.stringify([selected,latestDate,Boolean(pendingDayData),calendarOpen,calendarMonth,calendarLoading,calendarError,calendarData]);
      if(signature===lastNavigationSignature)return;lastNavigationSignature=signature;
      const active=document.activeElement;const focused=navHost.contains(active)?{date:active.getAttribute?.('data-date'),label:active.getAttribute?.('aria-label')}:null;
      const restoreFocus=()=>{if(!focused)return;const buttons=[...navHost.querySelectorAll('button')];const target=buttons.find(button=>!button.disabled&&(focused.date?button.getAttribute('data-date')===focused.date:button.getAttribute('aria-label')===focused.label))||buttons.find(button=>button.getAttribute('aria-label')===t.uiOpenCalendar);target?.focus();};
      navHost.replaceChildren();
      const bar=el('div','feast-datebar');
      const prev=el('button',null,'‹');prev.setAttribute('aria-label',t.uiPreviousDay);prev.disabled=selected==='0001-01-01';prev.onclick=()=>void openDay(shiftDate(selected,-1));
      const label=el('button','feast-date-current',new Intl.DateTimeFormat(ctx.language==='en'?'en':'zh-CN',{month:'long',day:'numeric',weekday:'short',timeZone:'UTC'}).format(new Date(selected+'T12:00:00Z')));
      label.setAttribute('aria-label',t.uiOpenCalendar);label.setAttribute('aria-expanded',String(calendarOpen));label.title=selected;
      label.onclick=()=>{calendarOpen=!calendarOpen;if(calendarOpen){if(!calendarMonth)calendarMonth=selected.slice(0,7);void loadMonth(calendarMonth);}else{calendarSequence++;calendarLoading=false;renderDateNavigation();}rememberView();};
      const next=el('button',null,'›');next.setAttribute('aria-label',t.uiNextDay);next.disabled=selected>=latestDate;next.onclick=()=>void openDay(shiftDate(selected,1));
      const today=el('button',null,t.uiReturnToday);today.disabled=!viewing&&selected===latestDate&&!pendingDayData;today.onclick=()=>void openDay(latestDate);
      bar.appendChild(prev);bar.appendChild(label);bar.appendChild(next);bar.appendChild(today);navHost.appendChild(bar);
      if(!calendarOpen){restoreFocus();return;}
      const calendar=el('div','feast-calendar');
      const head=el('div','feast-calendar-head');
      const pm=el('button',null,'‹');pm.setAttribute('aria-label',t.uiPreviousMonth);pm.disabled=calendarMonth==='0001-01';pm.onclick=()=>void loadMonth(shiftMonth(calendarMonth,-1));
      const nm=el('button',null,'›');nm.setAttribute('aria-label',t.uiNextMonth);nm.disabled=calendarMonth>=latestDate.slice(0,7);nm.onclick=()=>void loadMonth(shiftMonth(calendarMonth,1));
      head.appendChild(pm);head.appendChild(el('b',null,calendarMonth));head.appendChild(nm);calendar.appendChild(head);
      if(calendarLoading)calendar.appendChild(el('div','feast-note',t.uiCalendarLoading));
      const grid=el('div','feast-calendar-grid');grid.setAttribute('role','group');grid.setAttribute('aria-label',calendarMonth);
      for(let i=0;i<7;i++){const date=new Date('2026-11-'+String(16+i)+'T12:00:00Z');grid.appendChild(el('span',null,new Intl.DateTimeFormat(ctx.language==='en'?'en':'zh-CN',{weekday:'short',timeZone:'UTC'}).format(date)));}
      const first=new Date(calendarMonth+'-01T12:00:00Z');for(let i=0;i<(first.getUTCDay()+6)%7;i++){const gap=el('span');gap.setAttribute('aria-hidden','true');grid.appendChild(gap);}
      const end=new Date(first);end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);
      const markers=new Map(calendarData?.month===calendarMonth?(calendarData.days||[]).map(day=>[day.date,day]):[]);
      for(let i=1;i<=end.getUTCDate();i++){
        const date=calendarMonth+'-'+String(i).padStart(2,'0');const marker=markers.get(date);const future=date>latestDate;
        const day=el('button');day.setAttribute('data-date',date);day.setAttribute('aria-pressed',String(date===selected));day.disabled=future;
        const labels=[date];if(marker?.hasActual===true)labels.push(t.uiHasActual);if(marker?.hasCards===true)labels.push(t.uiHasCards);
        const unknown=!future&&(marker?.hasActual===null||marker?.hasCards===null);if(unknown)labels.push(t.uiUnknownRecords);else if(marker&&marker.hasActual===false&&marker.hasCards===false)labels.push(t.uiNoAvailableRecords);
        day.setAttribute('aria-label',labels.join(' · '));day.title=labels.join(' · ');day.appendChild(el('span',null,String(i)));
        day.appendChild(el('span','feast-calendar-marks',(marker?.hasActual===true?'● ':'')+(marker?.hasCards===true?'◇ ':'')+(unknown?'?':'')));
        day.onclick=()=>{calendarOpen=false;calendarSequence++;void openDay(date);};
        day.addEventListener('keydown',(event)=>{const amount={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];if(!amount)return;event.preventDefault();const destination=shiftDate(date,amount);const button=[...grid.querySelectorAll('button')].find(item=>item.getAttribute('data-date')===destination&&!item.disabled);button?.focus();});
        grid.appendChild(day);
      }
      calendar.appendChild(grid);calendar.appendChild(el('div','feast-note',t.uiCalendarLegend));
      if(calendarError){const issue=el('div','feast-note is-bad',calendarError);issue.setAttribute('role','alert');const retry=el('button',null,t.uiRetry);retry.onclick=()=>void loadMonth(calendarMonth);issue.appendChild(retry);calendar.appendChild(issue);}
      navHost.appendChild(calendar);restoreFocus();
    }
    async function loadMonth(month) {
      if(!alive()||!/^\d{4}-\d{2}$/.test(month))return false;
      const sequence=++calendarSequence;calendarMonth=month;calendarLoading=true;calendarError='';renderDateNavigation();rememberView();
      try{const result=await ctx.invoke('calendar',[month]);if(!alive()||sequence!==calendarSequence||!calendarOpen)return false;if(!result?.ok||result.month!==month)throw Error(result?.message||t.uiCalendarFailed);calendarData=result;latestDate=result.today||latestDate;return true;}
      catch(err){if(alive()&&sequence===calendarSequence)calendarError=t.uiCalendarFailed;return false;}
      finally{if(alive()&&sequence===calendarSequence){calendarLoading=false;renderDateNavigation();}}
    }
    async function openDay(date,{saved=false}={}) {
      if(!alive()||!validViewDate(date)||date>latestDate)return false;
      stashCurrent();rememberView();const targetPosition=Number(positions[date===latestDate?'today':date])||0;const sequence=++reviewSequence;requestSequence++;calendarSequence++;calendarOpen=false;
      setViewStatus(t.uiReviewLoading(date));
      try{
        if(date===latestDate){
          const next=await ctx.invoke('list',[]);if(!alive()||sequence!==reviewSequence)return false;
          data=next;latestDate=next.date;pendingDayData=null;viewing=null;currentReview=null;
        }else{
          const review=await ctx.invoke('review',[date]);if(!alive()||sequence!==reviewSequence)return false;
          if(!review?.ok||review.date!==date)throw Error(review?.message||t.uiRefreshFailed);
          currentReview=review;viewing=date;
        }
        calendarMonth=date.slice(0,7);workPreview=null;workPreviewDate=null;presetPreview=null;
        render();setViewScrollTop(root,wrap,targetPosition);setViewStatus();rememberView();return true;
      }catch(err){if(alive()&&sequence===reviewSequence){setViewStatus(saved?t.uiSavedRefreshFailed:t.uiRefreshFailed,true,()=>openDay(date));renderDateNavigation();}return false;}
    }
    function paintHistory() {
      wrap.replaceChildren();changeInputs=null;changeInputDate='';
      const seen=el('div','feast-seen');seen.appendChild(el('h2','feast-today-title',t.uiReviewTitle(viewing)));
      if(!currentReview){seen.appendChild(el('div','feast-empty',t.uiNothingSelected));wrap.appendChild(seen);return;}
      const plan=el('details');plan.open=browse.historyPlanOpen===true;plan.appendChild(el('summary',null,t.uiHistoryPlan));plan.appendChild(daySection(viewing,currentReview.day,null));seen.appendChild(plan);
      for(const issue of currentReview.issues||[])seen.appendChild(el('div','feast-note is-bad',issue.message));
      const actual=el('div','feast-today-actual');actual.appendChild(el('div','feast-block-t',t.uiHistoryActual));actual.appendChild(journalSection(viewing,currentReview.actual||[],currentReview.journal));seen.appendChild(actual);wrap.appendChild(seen);
    }

    function feedback(text = '', bad = false) {
      const node = el('div', 'feast-feedback' + (bad ? ' is-bad' : ''), text);
      node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
      return node;
    }

    function journalSection(date, actual, journal) {
      let draft = journalDrafts.get(date);
      if (!draft) {
        draft = { title: journal?.title ?? '', cardTitle: '', titleDirty: false, cardDirty: false, selected: new Set(), message: '', bad: false };
        journalDrafts.set(date, draft);
      } else if (!draft.titleDirty) draft.title = journal?.title ?? '';
      if(!(draft.openCards instanceof Set))draft.openCards=new Set();
      const box = el('div', 'feast-journal');
      const heading=mark(el('div'),'journal-title');if(journal?.title)heading.appendChild(el('div','feast-today-title',t.journalManual+': '+journal.title));box.appendChild(heading);
      const recordsHost=mark(el('div','feast-journal-records'),'journal-records');box.appendChild(recordsHost);
      const actuals = actual ?? [];
      const available = new Set(actuals.map((entry) => entry.id));
      for (const id of draft.selected) if (!available.has(id)) draft.selected.delete(id);
      if (!actuals.length) recordsHost.appendChild(el('div', 'feast-empty', t.journalEmpty));
      const visibleRecords=draft.recordsExpanded?actuals:actuals.slice(-5);
      for (const entry of visibleRecords) {
        const row = el('label', 'feast-actual-row');
        const check = el('input'); check.type = 'checkbox'; check.checked = draft.selected.has(entry.id);
        check.disabled = !journal || operating;
        check.setAttribute('aria-label', entry.hm + ' ' + entry.text);
        check.onchange = () => {
          if (check.checked && draft.selected.size >= 2) { check.checked = false; notify(t.journalBadSelection, true); return; }
          if (check.checked) draft.selected.add(entry.id); else draft.selected.delete(entry.id);
        };
        row.appendChild(check);
        row.appendChild(el('span', 'feast-item-t', entry.hm || ''));
        row.appendChild(el('span', 'feast-category', entry.kind === 'meal' ? t.todayActualMeal : t.todayActualActivity));
        row.appendChild(el('span', 'feast-item-n', (entry.text || '') + (entry.note ? ' · ' + entry.note : '')));
        const useTitle = el('button', null, t.journalUseTitle);
        useTitle.disabled = !journal || operating;
        useTitle.onclick = (event) => {
          event?.preventDefault?.();
          draft.title = [...entry.text].slice(0, 60).join(''); draft.titleDirty = true;
          tools.open = true;
          title.value = draft.title; title.focus();
        };
        row.appendChild(useTitle);
        recordsHost.appendChild(row);
      }
      if(actuals.length>5){const more=el('button',null,draft.recordsExpanded?t.uiCollapseRecords:t.uiExpandRecords+' ('+actuals.length+')');more.onclick=()=>{draft.recordsExpanded=!draft.recordsExpanded;render();rememberView();};recordsHost.appendChild(more);}
      box.appendChild(el('div', 'feast-note', t.journalCoverage));
      if (!journal) return box;
      const tools = mark(el('details','feast-journal-tools'),'journal-tools');
      tools.open = Boolean(draft.toolsOpen || draft.titleDirty || draft.cardDirty || draft.selected.size || draft.message);
      tools.addEventListener('toggle',()=>{if(!alive()||staging||!root.contains(tools))return;draft.toolsOpen=tools.open;if(!tools.open)draft.message='';rememberView();});
      tools.appendChild(el('summary', null, t.journalTools));
      const titleForm = el('div', 'feast-form');
      const title = el('input', 'feast-journal-title'); title.value = draft.title; title.maxLength = 120;
      title.placeholder = t.journalTitlePh; title.setAttribute('aria-label', t.journalTitle);
      title.oninput = () => { draft.title = title.value; draft.titleDirty = true; };
      const saveTitle = el('button', null, t.journalSaveTitle); saveTitle.disabled = operating;
      const status = feedback(draft.message, draft.bad);
      const save = async (button, payload) => {
        if (operating) return;
        operating = true; button.disabled = true; button.textContent = t.saving;
        status.textContent = t.saving; draft.message = t.saving; draft.bad = false;
        try {
          const result = await ctx.invoke('journal', [{ date, ...payload }]);
          if (result?.ok === false) throw new Error(result.message || t.sayNo);
          draft.message = payload.action === 'title' ? t.uiTitleSaved(date) : t.uiCardSaved(date); draft.bad = false;
          if(payload.action==='title'){if(draft.title===payload.title)draft.titleDirty=false;}
          else {if(draft.cardTitle===payload.title&&JSON.stringify([...draft.selected])===JSON.stringify(payload.selectedIds)){draft.selected.clear();draft.cardDirty=false;draft.cardTitle='';cardTitle.value='';for(const check of recordsHost.querySelectorAll('input'))if(check.type==='checkbox')check.checked=false;}if(result.card?.id)draft.openCards.add(result.card.id);}
          operating=false;if(!alive())return;status.textContent=draft.message;
          if((viewing||data.date)===date){if(!viewing)await refresh({saved:true});else await openDay(date,{saved:true});}else notify(draft.message);
        } catch (err) {
          draft.bad = true; draft.message = t.failed(err?.message ?? err);
          status.textContent = draft.message; status.classList.add('is-bad');
        } finally { operating = false; button.disabled = false; button.textContent = payload.action === 'title' ? t.journalSaveTitle : t.journalSaveCard; }
      };
      saveTitle.onclick = () => void save(saveTitle, { action: 'title', title: draft.title });
      titleForm.appendChild(title); titleForm.appendChild(saveTitle); tools.appendChild(titleForm);
      tools.appendChild(el('div', 'feast-note', t.journalSelect));
      const cardForm = el('div', 'feast-form');
      const cardTitle = el('input', 'feast-card-title'); cardTitle.value = draft.cardTitle; cardTitle.maxLength = 120;
      cardTitle.placeholder = t.journalCardTitle; cardTitle.setAttribute('aria-label', t.journalCardTitle);
      cardTitle.oninput = () => { draft.cardTitle = cardTitle.value; draft.cardDirty = true; };
      const saveCard = el('button', 'feast-btn-primary', t.journalSaveCard); saveCard.disabled = operating || !actuals.length;
      saveCard.onclick = () => {
        if (draft.selected.size < 1 || draft.selected.size > 2) { status.textContent = t.journalBadSelection; status.classList.add('is-bad'); return; }
        void save(saveCard, { action: 'card', title: draft.cardTitle, selectedIds: [...draft.selected] });
      };
      cardForm.appendChild(cardTitle); cardForm.appendChild(saveCard); tools.appendChild(cardForm); tools.appendChild(status); box.appendChild(tools);
      const cardsHost=mark(el('div','feast-journal-cards'),'journal-cards');box.appendChild(cardsHost);
      if (journal.cards?.length) cardsHost.appendChild(el('div', 'feast-combo-h', t.journalCards));
      for (const card of journal.cards ?? []) {
        const saved = el('details', 'feast-memory-card');saved.setAttribute('data-card-id',card.id);saved.open=draft.openCards.has(card.id);
        saved.addEventListener('toggle',()=>{if(saved.open)draft.openCards.add(card.id);else draft.openCards.delete(card.id);rememberView();});
        saved.appendChild(el('summary',null,(card.title?t.journalManual+': '+card.title:date)+' · '+(card.entries[0]?.text||'').slice(0,48)));
        for (const entry of card.entries) saved.appendChild(el('div', 'feast-note', entry.hm + ' · ' + entry.text + (entry.note ? ' · ' + entry.note : '')));
        const download = el('button', null, t.journalDownload);
        const exportStatus = feedback();
        download.onclick = async () => {
          download.disabled = true; download.textContent = t.journalExporting;
          try {
            const result = await ctx.invoke('journal', [{ action: 'export', date, cardId: card.id }]);
            if (!alive()) return;
            if (result?.ok === false || typeof result?.text !== 'string') throw new Error(result?.message || t.sayNo);
            let output = saved.querySelector('textarea');
            if (!output) { output = el('textarea'); output.readOnly = true; output.setAttribute('aria-label', t.journalCards); saved.appendChild(output); }
            output.value = result.text; output.rows = 7;
            exportStatus.textContent = t.journalExportReady;
            if (typeof Blob !== 'function' || typeof URL?.createObjectURL !== 'function') { exportStatus.textContent = t.journalDownloadUnavailable; return; }
            const url = URL.createObjectURL(new Blob(['\ufeff', result.text], { type: 'text/plain;charset=utf-8' }));
            downloadUrls.add(url);
            const link = el('a'); link.href = url; link.download = 'fish-day-' + date + '-' + card.id.slice(0, 8) + '.txt';
            saved.appendChild(link);
            try { link.click(); } finally { link.remove(); }
            ctx.timeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 1000);
          } catch (err) { exportStatus.textContent = t.failed(err?.message ?? err); exportStatus.classList.add('is-bad'); }
          finally { download.disabled = false; download.textContent = t.journalDownload; }
        };
        saved.appendChild(download); saved.appendChild(exportStatus); cardsHost.appendChild(saved);
      }
      return box;
    }

    function presetSection() {
      const box = mark(el('div', 'feast-block'),'preset');
      box.appendChild(el('div', 'feast-block-t', t.presetTitle));
      box.appendChild(el('div', 'feast-note', t.presetHint));
      const choose = el('select'); choose.setAttribute('aria-label', t.presetTitle);
      for (const [id, label] of [['quiet', t.presetQuiet], ['daily', t.presetDaily], ['lively', t.presetLively]]) choose.appendChild(option(label, id));
      choose.value = presetId;
      choose.onchange = () => { presetId = choose.value; presetPreview = null; presetMessage = ''; render(); };
      const row = el('div', 'feast-form'); row.appendChild(choose);
      const preview = el('button', null, t.presetPreview); preview.disabled = operating;
      preview.onclick = async () => {
        if (operating) return;
        operating = true; preview.disabled = true; preview.textContent = t.previewing;
        try {
          const result = await ctx.invoke('style', [{ action: 'preview', preset: presetId }]);
          if (result?.ok === false) throw new Error(result.message || t.sayNo);
          presetPreview = result; presetMessage = ''; presetBad = false;
        } catch (err) { presetMessage = t.failed(err?.message ?? err); presetBad = true; }
        finally { operating = false; render(); }
      };
      row.appendChild(preview); box.appendChild(row);
      const description = data.lifePresets?.find((item) => item.id === presetId)?.labels?.[ctx.language === 'en' ? 'en' : 'zh']?.description;
      if (description) box.appendChild(el('div', 'feast-note', description));
      if (data.canApplyLifePreset === false) box.appendChild(el('div', 'feast-note', t.presetUnavailable));
      if (presetPreview) {
        const panel = el('div', 'feast-preset-preview');
        const valueText = (value) => value === true ? t.presetOn : value === false ? t.presetOff : value === '' || value == null ? t.presetEmpty : String(value);
        for (const change of presetPreview.changes ?? []) panel.appendChild(el('div', 'feast-note', (t.presetFields[change.key] || change.key) + ': ' + t.presetCurrent + ' ' + valueText(change.from) + ' → ' + t.presetAfter + ' ' + valueText(change.to)));
        if (!presetPreview.changes?.length) panel.appendChild(el('div', 'feast-note', t.presetNoChanges));
        const apply = el('button', 'feast-btn-primary feast-preset-apply', t.presetApply);
        apply.disabled = operating || !presetPreview.canApply || !presetPreview.changes?.length;
        const message = feedback(presetMessage, presetBad);
        apply.onclick = async () => {
          if (operating || apply.disabled) return;
          operating = true; let applied=false; apply.disabled = true; apply.textContent = t.saving; message.textContent = t.saving;
          try {
            const result = await ctx.invoke('style', [{ action: 'apply', preset: presetPreview.id, revision: presetPreview.revision }]);
            if (result?.ok === false) { if (result.stale) presetPreview = null; throw new Error(result.message || t.sayNo); }
            applied=true;const names={quiet:t.presetQuiet,daily:t.presetDaily,lively:t.presetLively};presetMessage=t.uiPresetSaved(names[presetPreview.id]||presetPreview.id);presetPreview=null;presetBad=false;
          } catch (err) { presetMessage = t.failed(err?.message ?? err); presetBad = true; }
          finally { operating=false;if(alive()){message.textContent=presetMessage;apply.disabled=false;apply.textContent=t.presetApply;await refresh({saved:applied});} }
        };
        const cancel = el('button', null, t.presetCancel); cancel.disabled = operating;
        cancel.onclick = () => { presetPreview = null; presetMessage = ''; render(); };
        panel.appendChild(apply); panel.appendChild(cancel); panel.appendChild(message); box.appendChild(panel);
      } else box.appendChild(feedback(presetMessage, presetBad));
      return box;
    }

    function reminderSection() {
      const block = el('div', 'feast-reminders');
      const { meal, free } = data.reminders ?? {};
      const states = {
        off: t.reminderOff, unavailable: t.reminderUnavailable, unconfigured: t.reminderUnconfigured,
        finished: t.reminderFinished, busy: t.reminderBusy, asleep: t.reminderAsleep, checkIn: t.reminderCheckIn,
        due: t.reminderDue, catchUp: t.reminderCatchUp, retry: t.reminderRetry, waiting: t.reminderWaiting,
      };
      for (const [label, reminder, paused] of [[t.reminderMeal, meal, t.reminderMealPaused], [t.reminderFree, free, t.reminderFreePaused]]) {
        if (!reminder) continue;
        let detail = states[reminder.status];
        if (reminder.status === 'paused') detail = paused;
        if (reminder === meal && ['scheduled', 'due', 'catchUp', 'retry', 'waiting'].includes(reminder.status)) {
          const source = meal.source === 'her' ? t.reminderHer : t.reminderConfig;
          detail = detail ? `${detail} · ${source}` : source;
        }
        const row = el('div', 'feast-note');
        const slot = reminder.slot === '补' ? t.reminderCatchUpSlot : reminder.slot;
        row.appendChild(el('b', null, slot ? `${label} ${slot}` : label));
        if (detail) row.appendChild(document.createTextNode(` · ${detail}`));
        block.appendChild(row);
      }
      if (free?.lastSkipped) {
        const { slot, doing } = free.lastSkipped;
        block.appendChild(el('div', 'feast-note', t.reminderFreeSkipped(slot, doing)));
      }
      return block;
    }

    function paintFull() {
      const scrollTop = viewScrollTop(root,wrap);
      if (workPreview && workPreviewDate !== data?.date) workPreview = null;
      const savedChange = changeInputs && changeInputDate===data?.date ? {
        start: changeInputs.startIn.value, end: changeInputs.endIn.value, activity: changeInputs.actIn.value, category: changeInputs.categoryIn.value,
      } : changeDrafts.get(data?.date) || null;
      draftNode = null;
      changeInputs = null;
      wrap.replaceChildren();

      if (!data) return;

      const storageHost=mark(el('div'),'storage');const storage=storageSection();if(storage)storageHost.appendChild(storage);wrap.appendChild(storageHost);
      if (!data.enabled) {
        wrap.appendChild(el('div', 'feast-empty', t.dayOff));
        wrap.appendChild(journalSection(data.date, data.actual ?? [], data.journal));
        wrap.appendChild(pastSection());
        return;
      }

      // 首页先呈现生活摘要。计划与实际记录明确分开，绝不把安排写成已发生。
      const home = el('div', 'feast-stats feast-today-home');
      const todayTop = mark(el('div', 'feast-today-top'),'header');
      const topDay = data.today ?? {};
      todayTop.appendChild(el('b', null, `${t.todayDate} ${data.date ?? ''}`));
      if (topDay.dayType?.name) todayTop.appendChild(el('span', 'feast-flag', topDay.dayType.name));
      if (topDay.mood) todayTop.appendChild(el('span', 'feast-today-mood', t.todayMood(topDay.mood)));
      if (topDay.title) todayTop.appendChild(el('span', 'feast-today-title', topDay.title));
      const todayReady = topDay.source !== 'pending' && Boolean(topDay.items?.length);
      const workLabel = data.storageIssues?.some((issue) => issue.key === 'today') ? t.todayWorkReadError
        : !todayReady ? t.todayWorkUnknown
        : data.work ? t.todayWorking : t.todayNotWorking;
      todayTop.appendChild(el('span', `feast-work-pill${todayReady && data.work ? ' is-on' : ''}`, workLabel));
      if (!data.workSchedulingError && data.workSchedulingEnabled === false && data.retainedWork?.today) {
        todayTop.appendChild(el('span', 'feast-note', t.todayWorkRetained));
      }
      home.appendChild(todayTop);
      const work = workSection();
      work.classList.add('feast-today-status');
      // 工作规则和编辑器放在下方的管理折叠区，先展示她的一天。
      const planCard = mark(el('div', 'feast-stat feast-current-plan'),'current');
      planCard.appendChild(el('div', 'feast-block-t', t.todayPlanTitle));
      planCard.appendChild(el('div', 'feast-note', t.todayPlanDisclaimer));
      const nowMinute = Number.isFinite(data.nowMinute) ? data.nowMinute : minuteOf(data.nowHm);
      const now = data.nowItem ?? (data.today?.items ?? []).find((item) => {
        const start = minuteOf(item.start); const end = minuteOf(item.end);
        return start !== null && end !== null && nowMinute !== null && start <= nowMinute && nowMinute < end;
      });
      const current = el('div', 'feast-stat-v');
      current.appendChild(document.createTextNode(now ? `${now.start}–${now.end} ${now.activity ?? ''}` : t.dayNothingNow));
      if (data.nowHm) current.appendChild(document.createTextNode(` · ${t.dayNowAt(data.nowHm)}`));
      planCard.appendChild(current);
      if (now?.location || now?.scene) current.appendChild(document.createTextNode(`（${now.scene || now.location}）`));
      home.appendChild(planCard);
      const nextCard = mark(el('div', 'feast-stat'),'next');
      nextCard.appendChild(el('div', 'feast-block-t', t.todayNextTitle));
      for (const item of (data.upcoming ?? []).slice(0, 3)) nextCard.appendChild(el('div', 'feast-item', `${item.start ?? item.hm ?? ''} ${item.activity ?? item.text ?? ''}`));
      nextCard.appendChild(reminderSection());
      if (data.pending) nextCard.appendChild(el('div', 'feast-note', t.todayPendingMeal));
      const togetherActive = Boolean(data.together?.active ?? data.together?.isTogether);
      if (data.together?.invite || togetherActive) nextCard.appendChild(el('div', 'feast-note', togetherActive ? t.todayTogetherActive : t.todayTogetherInvite));
      home.appendChild(nextCard);
      const actualCard = el('div', 'feast-stat feast-today-actual');
      actualCard.appendChild(el('div', 'feast-block-t', t.todayActualTitle));
      actualCard.appendChild(journalSection(data.date, data.actual ?? [], data.journal));
      home.appendChild(actualCard);
      wrap.appendChild(home);

      // 今天：只有看今天时才给 nowMinute 高亮。点任意一段能填进下面的改主意表单。
      const canChangeToday = Boolean(data.today?.items?.length) && data.today.source !== 'pending';
      const oldTimeline = mark(el('div'),'timeline');
      oldTimeline.appendChild(el('div', 'feast-combo-h', t.dayToday));
      const todayTimeline = daySection('', data.today, isToday() && !viewing ? data.nowMinute : null, {
        meals: data.mealSlots ?? [], eatenAt: (data.eatenToday ?? []).map((e) => e.at),
        clickable: canChangeToday && !viewing,
      });
      todayTimeline.hidden = !todayTimelineOpen;
      const todayToggle = el('button', 'feast-timeline-toggle', todayTimelineOpen ? t.todayTimelineClose : t.todayTimelineOpen);
      todayToggle.onclick = () => { todayTimelineOpen = !todayTimelineOpen; todayTimeline.hidden = !todayTimelineOpen; todayToggle.textContent = todayTimelineOpen ? t.todayTimelineClose : t.todayTimelineOpen; rememberView(); };
      oldTimeline.appendChild(todayToggle); oldTimeline.appendChild(todayTimeline);
      wrap.appendChild(oldTimeline);
      const tomorrow = mark(el('div'),'tomorrow');
      tomorrow.appendChild(el('div', 'feast-combo-h', t.dayTomorrow));
      const tomorrowMeta = el('div', 'feast-tomorrow-state');
      const tomorrowSource = sourceLabel(data.tomorrow?.source);
      tomorrowMeta.appendChild(el('span', 'feast-flag', tomorrowSource || t.todaySourceMissing));
      if (data.tomorrow?.generatedAt && ['pending', 'coo', 'template', 'manual'].includes(data.tomorrow.source)) {
        const at = Number(data.tomorrow.generatedAt);
        const formatted = Number.isFinite(at) ? new Intl.DateTimeFormat(ctx.language === 'en' ? 'en' : 'zh-CN', {
          timeZone: data.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        }).format(new Date(at)) : String(data.tomorrow.generatedAt);
        tomorrowMeta.appendChild(el('span', 'feast-dim', data.tomorrow.source === 'pending'
          ? t.todayTomorrowRequestAt(formatted) : t.todayTomorrowUpdatedAt(formatted)));
      }
      tomorrow.appendChild(tomorrowMeta);
      if (data.tomorrow?.title || data.tomorrow?.dayType?.name || data.tomorrow?.items?.length) {
        const summary = el('div', 'feast-tomorrow-state');
        summary.appendChild(el('b', null, t.todayTomorrowSummary));
        if (data.tomorrow?.dayType?.name) summary.appendChild(el('span', 'feast-flag', data.tomorrow.dayType.name));
        if (data.tomorrow?.title) summary.appendChild(el('span', null, data.tomorrow.title));
        const major = (data.tomorrow?.items ?? []).filter((item) => item.displayCategory !== 'sleep').slice(0, 3);
        if (major.length) summary.appendChild(el('span', 'feast-dim', major.map((item) => `${item.start} ${item.activity}`).join(' · ')));
        else summary.appendChild(el('span', 'feast-dim', t.todayTomorrowNoActivities));
        tomorrow.appendChild(summary);
      }
      if (!data.workSchedulingError && data.workSchedulingEnabled === false && data.retainedWork?.tomorrow) {
        tomorrow.appendChild(el('div', 'feast-note feast-work-retained', t.tomorrowWorkRetained));
      }

      // 按钮跟着明天的状态走：没写 = 请她写；等她写 = 灰掉；已经写好 = 重写（要确认）。
      // 0.7.1 无脑渲染「请她写明天」，而服务端会无条件覆盖——点一下就抹掉她写好的明天。
      const tomorrowState = data.tomorrow?.source === 'pending'
        ? 'pending'
        : (data.tomorrow?.items?.length ?? 0) > 0 ? 'written' : 'empty';

      const acts = el('div', 'feast-act');
      if (tomorrowState === 'pending') {
        const ask = el('button', null, t.dayAsking);
        ask.disabled = true;
        acts.appendChild(ask);
        acts.appendChild(el('span', 'feast-dim', t.dayWaiting));
        if (data.planRetryAvailable) {
          const retry = el('button', null, t.todayPlanRetry);
          retry.onclick = async () => {
            if (!window.confirm(t.todayPlanRetryConfirm)) return;
            retry.disabled = true;
            operating = true;
            try {
              const result = await ctx.invoke('plan', [{ retry: true }]);
              if (result?.ok === false) notify(result.message ?? t.sayNo, true);
              else if (result?.message) notify(result.message);
            } catch (err) {
              notify(t.failed(err?.message ?? err), true);
            } finally {
              operating = false;
              await refresh();
            }
          };
          acts.appendChild(retry);
        }
      } else {
        const rewrite = tomorrowState === 'written';
        const ask = el('button', rewrite ? null : 'feast-btn-primary',
          asking ? t.dayAsking : (rewrite ? t.dayAskAgain : t.dayAsk));
        ask.disabled = asking;
        ask.onclick = async () => {
          if (rewrite && !window.confirm(t.dayRewriteConfirm)) return;
          asking = true;
          render();
          try {
            const r = await ctx.invoke('plan', []);
            if (r?.ok) notify(r.message ?? t.dayAsking);
            else notify(r?.message ?? t.sayNo, true);
          } catch (err) {
            notify(t.failed(err?.message ?? err), true);
          } finally {
            asking = false;
            await refresh();
          }
        };
        acts.appendChild(ask);
        if (rewrite) acts.appendChild(el('span', 'feast-dim', t.dayAskAgainHint));
      }
      tomorrow.appendChild(acts);
      const tomorrowToggle = el('button', 'feast-timeline-toggle', t.todayTimelineOpen);
      const tomorrowBody = daySection('', data.tomorrow, null);
      tomorrowBody.hidden = !tomorrowTimelineOpen;
      tomorrowToggle.textContent = tomorrowTimelineOpen ? t.todayTimelineClose : t.todayTimelineOpen;
      tomorrowToggle.onclick = () => { tomorrowTimelineOpen = !tomorrowTimelineOpen; tomorrowBody.hidden = !tomorrowTimelineOpen; tomorrowToggle.textContent = tomorrowTimelineOpen ? t.todayTimelineClose : t.todayTimelineOpen; rememberView(); };
      tomorrow.appendChild(tomorrowToggle);
      tomorrow.appendChild(tomorrowBody);
      wrap.appendChild(tomorrow);

      const controls = mark(el('details', 'feast-today-controls feast-management'),'controls');
      controls.open = Boolean(controlsOpen || workPreview);
      controls.addEventListener('toggle', () => { if(staging||!root.contains(controls))return;controlsOpen=controls.open;rememberView(); });
      controls.appendChild(el('summary', null, t.controlsTitle));
      controls.appendChild(work);
      controls.appendChild(presetSection());
      const changeHost=mark(el('div'),'change');if(canChangeToday)changeHost.appendChild(changeForm(data.date));controls.appendChild(changeHost);
      wrap.appendChild(controls);

      const threads = threadsSection();
      wrap.appendChild(threads);

      if (savedChange && changeInputs) {
        changeInputs.startIn.value = savedChange.start;
        changeInputs.endIn.value = savedChange.end;
        changeInputs.actIn.value = savedChange.activity;
        changeInputs.categoryIn.value = savedChange.category;
      }
      const freePlanHost=mark(el('div'),'free-plan');wrap.appendChild(freePlanHost);
      const freePlanSlots = data.freePlanSlots ?? [];
      if (freePlanSlots.length) {
        const freePlan = el('div', 'feast-free-plan');
        freePlan.appendChild(el('span', null, `${t.todayFreePlan}: ${freePlanSlots.map((s) => `${s.start}–${s.end}`).join('、')}`));
        const fill = el('button', null, data.fillFreePending ? t.todayFreePending : t.todayFreePlan);
        fill.disabled = !data.fillFreeAvailable || data.fillFreePending;
        fill.onclick = async () => {
          if (operating || !data.fillFreeAvailable || !freePlanSlots.length) return;
          operating = true; fill.disabled = true;
          try {
            const result = await ctx.invoke('fillFree', []);
            if (result?.ok === false) notify(result.message ?? t.sayNo, true);
            else notify(result?.message ?? t.todayFreePending);
          } catch (err) { notify(t.failed(err?.message ?? err), true); }
          finally { operating = false; await refresh(); }
        };
        freePlan.appendChild(fill); freePlanHost.appendChild(freePlan);
      }
      const freeHost=mark(el('div'),'free');const free=freeSection();if(free)freeHost.appendChild(free);wrap.appendChild(freeHost);

      const past = mark(el('details', 'feast-today-controls'),'past');
      past.open = pastOpen; past.addEventListener('toggle', () => { if(staging||!root.contains(past))return;pastOpen=past.open;rememberView(); });
      past.appendChild(el('summary', null, t.pastTitle)); past.appendChild(pastSection());
      wrap.appendChild(past);
      setViewScrollTop(root,wrap,scrollTop);
    }

    function render() {
      if(!alive()||staging)return;
      const scroll=viewPainted?viewScrollTop(root,wrap):(Number(positions[viewKey()])||0);
      if(viewing)paintHistory();else paintFull();
      viewPainted=true;setViewScrollTop(root,wrap,scroll);renderDateNavigation();rememberView();
    }
    function passiveSnapshot(next) {
      latestDate=next.date||latestDate;
      if(viewing){data=next;renderDateNavigation();return;}
      if(data&&next.date!==data.date&&(hasDraft()||operating)){pendingDayData=next;setViewStatus(t.uiNewDay,false,()=>openDay(latestDate));renderDateNavigation();return;}
      if(!data||next.date!==data.date||next.enabled!==data.enabled){pendingDayData=null;data=next;render();return;}
      const previous=data;const live=wrap;const oldChange=changeInputs,oldDate=changeInputDate,oldDraft=draftNode;
      const detached=el('div');const scroll=viewScrollTop(root,live);
      data=next;staging=true;wrap=detached;
      try{paintFull();}finally{wrap=live;staging=false;changeInputs=oldChange;changeInputDate=oldDate;draftNode=oldDraft;}
      const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
      const replace=(key,changed,protect=false)=>{if(!changed||protect)return;const old=island(live,key),fresh=island(detached,key);if(old&&fresh)replaceViewIsland(old,fresh);};
      replace('header',!equal([previous.today?.title,previous.today?.mood,previous.today?.dayType,previous.work,previous.workSchedulingEnabled,previous.retainedWork,previous.storageIssues],[next.today?.title,next.today?.mood,next.today?.dayType,next.work,next.workSchedulingEnabled,next.retainedWork,next.storageIssues]));
      replace('current',!equal([previous.nowItem,previous.nowHm],[next.nowItem,next.nowHm]));
      replace('next',!equal([previous.upcoming,previous.reminders,previous.pending,previous.together],[next.upcoming,next.reminders,next.pending,next.together]));
      replace('storage',!equal(previous.storageIssues,next.storageIssues));
      replace('journal-title',previous.journal?.title!==next.journal?.title);
      replace('journal-records',!equal(previous.actual,next.actual));
      const copying=[...live.querySelectorAll('textarea')].includes(document.activeElement);
      if(!equal(previous.journal?.cards,next.journal?.cards))deferredCards=true;
      replace('journal-cards',deferredCards,copying);if(!copying)deferredCards=false;
      const title=live.querySelector('.feast-journal-title');const draft=journalDrafts.get(next.date);if(title&&draft&&!draft.titleDirty&&title!==document.activeElement)title.value=next.journal?.title||'';
      if(!next.journal){const tools=island(live,'journal-tools');for(const button of tools?.querySelectorAll('button')||[])button.disabled=true;}
      const timelineChanged=!equal([previous.today?.items,previous.mealSlots,previous.eatenToday],[next.today?.items,next.mealSlots,next.eatenToday]);
      if(timelineChanged){
        const expanded=new Set([...island(live,'timeline')?.querySelectorAll('.feast-tl-row')||[]].filter(row=>row.querySelector('details')?.open).map(row=>row.getAttribute('data-start')+'|'+row.getAttribute('data-end')));
        replace('timeline',true);
        for(const row of island(live,'timeline')?.querySelectorAll('.feast-tl-row')||[])if(expanded.has(row.getAttribute('data-start')+'|'+row.getAttribute('data-end'))){const details=row.querySelector('details');if(details)details.open=true;}
      }else for(const row of island(live,'timeline')?.querySelectorAll('.feast-tl-row')||[]){const start=minuteOf(row.getAttribute('data-start')),end=minuteOf(row.getAttribute('data-end'));row.classList.remove('is-now','is-past');if(start<=next.nowMinute&&next.nowMinute<end)row.classList.add('is-now');else if(end<=next.nowMinute)row.classList.add('is-past');}
      replace('tomorrow',!equal([previous.tomorrow,previous.planRetryAvailable],[next.tomorrow,next.planRetryAvailable]),asking||operating);
      replace('work',!equal([previous.work,previous.workConflicts,previous.workUndoAvailable,previous.workSchedulingEnabled,previous.workSchedulingError,previous.mealSlots],[next.work,next.workConflicts,next.workUndoAvailable,next.workSchedulingEnabled,next.workSchedulingError,next.mealSlots]),operating||Boolean(workPreview));
      replace('thread-list',!equal(previous.threads,next.threads),operating);
      replace('free-plan',!equal([previous.freePlanSlots,previous.fillFreePending,previous.fillFreeAvailable],[next.freePlanSlots,next.fillFreePending,next.fillFreeAvailable]),operating);
      replace('free',!equal(previous.free,next.free),operating);
      setViewScrollTop(root,live,scroll);renderDateNavigation();rememberView();
    }
    async function refresh({saved=false,passive=false}={}) {
      if(!alive())return false;
      const sequence=++requestSequence;const navigation=reviewSequence;
      try{
        const next=await ctx.invoke('list',[]);if(!alive()||sequence!==requestSequence||navigation!==reviewSequence)return false;
        if(passive)passiveSnapshot(next);else{data=next;latestDate=next.date;if(viewing){renderDateNavigation();}else render();}
        if(calendarOpen&&(!passive||!equalCalendarSource(next)))void loadMonth(calendarMonth);
        if(!pendingDayData)setViewStatus();return true;
      }catch(err){if(alive()&&sequence===requestSequence)setViewStatus(saved?t.uiSavedRefreshFailed:t.uiRefreshFailed,true,()=>refresh());return false;}
    }
    let lastCalendarSource='';
    let deferredCards=false;
    function equalCalendarSource(next){const value=JSON.stringify([next.actual,next.journal]);const same=value===lastCalendarSource;lastCalendarSource=value;return same;}
    try{
      data=await ctx.invoke('list',[]);if(!alive())return{dispose(){disposed=true;}};latestDate=data.date;
      if(viewing&&viewing<latestDate){const target=viewing;viewing=null;await openDay(target);}else{viewing=null;render();}
    }catch(err){if(alive()){wrap.replaceChildren(el('div','feast-empty is-bad',t.failed(err?.message??err)));setViewStatus(t.uiRefreshFailed,true,()=>refresh());}}
    const ticker=ctx.interval?.(()=>{if(alive())void refresh({passive:true});},60_000);
    const scroller=viewScrollOwner(root,wrap);
    let scrollSaveHandle=null;
    const onScroll=()=>{scrollSaveHandle?.dispose?.();if(ctx.timeout)scrollSaveHandle=ctx.timeout(()=>{scrollSaveHandle=null;rememberView();},160);else rememberView();};scroller?.addEventListener?.('scroll',onScroll,{passive:true});
    return{dispose(){if(disposed)return;stashCurrent();rememberView();disposed=true;requestSequence++;reviewSequence++;calendarSequence++;ticker?.dispose?.();scrollSaveHandle?.dispose?.();scroller?.removeEventListener?.('scroll',onScroll);for(const url of downloadUrls)URL.revokeObjectURL(url);downloadUrls.clear();}};
  },
};

// ---------------------------------------------------------------------------
// 套餐面板
// ---------------------------------------------------------------------------

/**
 * 一桌一桌地端。
 *
 * 分两半：上面是现成的套餐（预设 + 你攒的），下面是攒新的一桌。
 * 预设是「槽位现配」，每次配出来可能不一样，所以每张卡都带「换一桌」——
 * 端之前得看得到具体是哪几道。
 */
const comboPanel = {
  async mount(ctx) {
    const t = tableFor(ctx.language);
    const root = ctx.root;
    if (ctx.signal?.aborted) return { dispose() {} };
    const firstLoad = el('div', 'feast-empty', t.loading);
    root.appendChild(firstLoad);
    const memory = await viewMemory(ctx, 'combo');
    const browse = memory.browse ?? {};
    const draft = memory.drafts.combo ?? {};
    const PAGE = 120;
    const picked = new Map((Array.isArray(draft.picked) ? draft.picked : []).filter((id) => typeof id === 'string').map((id) => [id, true]));
    let editing = typeof draft.editing === 'string' ? draft.editing : null;
    const build = {
      filter: {
        category: typeof browse.filter?.category === 'string' ? browse.filter.category : undefined,
        cuisine: typeof browse.filter?.cuisine === 'string' ? browse.filter.cuisine : undefined,
      },
      q: typeof browse.q === 'string' ? browse.q : '',
    };
    let shown = Math.max(PAGE, Math.floor(Number(browse.shown) || PAGE));
    let outerScroll = Math.max(0, Number(browse.scrollTop) || 0);
    let pickScroll = Math.max(0, Number(browse.pickScrollTop) || 0);
    let data = null;
    const seeds = new Map();
    let pendingBox = null;
    let confirmId = null;
    let disposed = false;
    let request = 0;
    let loading = false;
    let writing = false;
    let refreshAfterWrite = false;
    let rendered = false;
    let ticker = null;
    const alive = () => !disposed && !ctx.signal?.aborted;
    const busy = () => loading || writing;
    if (!alive()) return { dispose() {} };
    root.classList.add('feast');
    const style = el('style');
    style.textContent = CSS;
    root.appendChild(style);
    const status = el('div', 'feast-line');
    status.setAttribute('role', 'status');
    const wrap = el('div');
    root.appendChild(status);
    root.appendChild(wrap);
    firstLoad.remove();

    const nameInput = el('input');
    nameInput.className = 'feast-search';
    nameInput.placeholder = t.comboNamePh;
    nameInput.value = typeof draft.name === 'string' ? draft.name : '';
    nameInput.oninput = () => syncDraft();
    const searchInput = el('input');
    searchInput.className = 'feast-search';
    searchInput.placeholder = t.search;
    searchInput.value = build.q;
    function searchChanged(e) {
      if (!alive() || writing || e?.isComposing) return;
      build.q = String(searchInput.value ?? '').trim();
      shown = PAGE;
      pickScroll = 0;
      render({ resetPick: true });
    }
    searchInput.oninput = searchChanged;
    searchInput.addEventListener('compositionend', searchChanged);

    function syncDraft() {
      const next = { name: String(nameInput.value ?? ''), picked: [...picked.keys()], editing };
      const previous = memory.drafts.combo;
      if (previous?.name === next.name && previous.editing === next.editing
        && Array.isArray(previous.picked) && previous.picked.length === next.picked.length
        && previous.picked.every((id, index) => id === next.picked[index])) return previous;
      memory.drafts.combo = next;
      return next;
    }
    function clearDraft(submitted = memory.drafts.combo) {
      // A result from an old mount must not erase a newer mount's edits.
      if (memory.drafts.combo !== submitted) return;
      delete memory.drafts.combo;
      if (!alive()) return;
      editing = null;
      picked.clear();
      nameInput.value = '';
    }
    function rememberBrowse(capture = true) {
      if (capture && rendered) {
        outerScroll = viewScrollTop(root, wrap);
        const pick = wrap.querySelector('.feast-pick');
        if (pick) pickScroll = pick.scrollTop;
      }
      memory.saveBrowse({ filter: { ...build.filter }, q: build.q, scrollTop: outerScroll, pickScrollTop: pickScroll, shown });
    }
    function onScroll() { if (alive() && rendered) rememberBrowse(); }
    const scrollNodes = [wrap];
    for (let node = root; node && node !== document.body && node !== document.documentElement; node = node.parentElement ?? node.host) {
      if (typeof node.addEventListener === 'function') scrollNodes.push(node);
    }
    for (const node of scrollNodes) node.addEventListener('scroll', onScroll, { passive: true });
    function showStatus(message = '', bad = false) {
      if (!alive()) return;
      status.className = `feast-line${bad ? ' is-bad' : ''}`;
      status.replaceChildren();
      if (message) status.appendChild(el('span', null, message));
      if (bad) {
        const retry = el('button', null, t.uiRetry);
        retry.onclick = () => { if (!busy()) void refresh(); };
        status.appendChild(retry);
      }
    }
    function syncBusy() {
      if (!alive()) return;
      for (const button of wrap.querySelectorAll('button')) button.disabled = busy();
      for (const input of wrap.querySelectorAll('input, select')) input.disabled = writing;
    }
    function remainMin(p) {
      const ttl = Number(p?.ttlMin) || 30;
      const at = Number(p?.at) || 0;
      const leftMs = at + ttl * 60_000 - Date.now();
      return leftMs <= 0 ? 0 : Math.ceil(leftMs / 60_000);
    }
    function newSeed(id) { return `${id}|${Date.now().toString(36)}`; }

    async function refresh({ afterWrite = false, previewId = null } = {}) {
      if (!alive()) return false;
      const current = ++request;
      loading = true;
      refreshAfterWrite = refreshAfterWrite || afterWrite;
      if (!data) wrap.replaceChildren(el('div', 'feast-empty', t.loading));
      showStatus(data ? t.uiUpdating : '');
      syncBusy();
      try {
        // Commit data and seeds together, so a failed preview cannot change the served table.
        const bare = await ctx.invoke('list', [{ resolve: false }]);
        if (!alive() || current !== request) return false;
        const cards = [...(bare.presets ?? []), ...(bare.custom ?? [])];
        const nextSeeds = new Map();
        for (const c of cards) nextSeeds.set(c.id, c.id === previewId ? newSeed(c.id) : (seeds.get(c.id) ?? newSeed(c.id)));
        const next = await ctx.invoke('list', [{ seeds: Object.fromEntries(nextSeeds) }]);
        if (!alive() || current !== request) return false;
        data = next;
        seeds.clear();
        for (const [id, seed] of nextSeeds) seeds.set(id, seed);
        const liveDishes = new Set((data.items ?? []).map((d) => d.id));
        for (const id of picked.keys()) if (!liveDishes.has(id)) picked.delete(id);
        if (editing && !(data.custom ?? []).some((c) => c.id === editing)) editing = null;
        if (build.filter.category && !(data.categories ?? []).includes(build.filter.category)) build.filter.category = undefined;
        const cuisines = build.filter.category ? (data.categoryCuisines?.[build.filter.category] ?? []) : (data.cuisines ?? []);
        if (build.filter.cuisine && !cuisines.includes(build.filter.cuisine)) build.filter.cuisine = undefined;
        if (picked.size || editing || nameInput.value) syncDraft();
        else delete memory.drafts.combo;
        loading = false;
        refreshAfterWrite = false;
        confirmId = null;
        showStatus();
        render();
        return true;
      } catch {
        if (!alive() || current !== request) return false;
        loading = false;
        if (!data) wrap.replaceChildren();
        showStatus(refreshAfterWrite ? t.uiSavedRefreshFailed : t.uiRefreshFailed, true);
        syncBusy();
        return false;
      }
    }
    async function writeAction(method, args, { message, clearBuilder = false } = {}) {
      if (!alive() || busy()) return;
      const submitted = memory.drafts.combo;
      writing = true;
      confirmId = null;
      showStatus(method === 'save' ? t.comboSaving : t.uiUpdating);
      syncBusy();
      let result;
      try {
        result = await ctx.invoke(method, args);
      } catch (err) {
        if (alive()) toast(root, ctx, t.failed(err?.message ?? err), true);
        writing = false;
        if (alive()) { showStatus(); render(); }
        return;
      }
      if (!result?.ok) {
        if (alive()) toast(root, ctx, result?.message ?? t.sayNo, true);
        writing = false;
        if (alive()) { showStatus(); render(); }
        return;
      }
      if (clearBuilder) clearDraft(submitted);
      if (!alive()) { writing = false; return; }
      toast(root, ctx, message ? message(result) : (result.message ?? t.sayOk));
      // The write has completed. Retry below is read-only even when this refresh fails.
      render();
      await refresh({ afterWrite: true });
      writing = false;
      syncBusy();
    }

    function pendingStrip(p) {
      const strip = el('div', 'feast-strip');
      const isTable = p.isTable || (p.total ?? 1) > 1;
      const title = isTable ? `${t.comboTable}${p.tableName ? ` · ${p.tableName}` : ''}` : p.name;
      strip.appendChild(el('b', null, `🍽 ${title}`));
      if (isTable) {
        const n = Number(p.remaining ?? p.left?.length ?? 0);
        const total = Number(p.total ?? n);
        strip.appendChild(el('span', 'feast-dim', t.comboLeft(n, total)));
        if (p.left?.length) strip.appendChild(el('span', 'feast-dim', p.left.join('、')));
      } else {
        strip.appendChild(el('span', 'feast-dim', `${t.pending} · ${t.pendingHint}`));
      }
      const left = el('span', 'feast-left', t.pendingLeft(remainMin(p)));
      strip.appendChild(left);
      pendingBox = { el: left, p };
      return strip;
    }
    function setCard(c, isCustom) {
      const card = el('div', 'feast-set');
      if (data?.pending?.comboId && data.pending.comboId === c.id) card.className += ' is-cur';
      const h = el('div', 'feast-set-h');
      h.appendChild(el('span', 'feast-set-n', c.name));
      h.appendChild(el('span', 'feast-set-m', [`${c.size} 道`, c.line].filter(Boolean).join(' · ')));
      card.appendChild(h);
      if (c.desc) card.appendChild(el('div', 'feast-set-d', c.desc));
      if (c.dishes?.length) {
        const row = el('div', 'feast-set-dishes');
        for (const d of c.dishes) row.appendChild(el('span', null, d.name));
        card.appendChild(row);
      } else if (c.missing?.length) {
        card.appendChild(el('div', 'feast-miss', t.comboMissing(c.missing.join('；'))));
      }
      const acts = el('div', 'feast-set-acts');
      const preview = el('button', null, t.comboPick);
      preview.onclick = () => { if (alive() && !busy()) void refresh({ previewId: c.id }); };
      acts.appendChild(preview);
      const serve = el('button', 'feast-btn-primary', t.comboServe);
      serve.onclick = () => void writeAction('serve', [{ id: c.id, seed: seeds.get(c.id) }], {
        message: (r) => t.served(`${c.name}（${r.dishes?.length ?? c.size}）`),
      });
      acts.appendChild(serve);
      if (isCustom) {
        const edit = el('button', null, t.comboEdit);
        edit.onclick = () => {
          if (!alive() || busy()) return;
          editing = c.id;
          picked.clear();
          const live = new Set((data.items ?? []).map((d) => d.id));
          for (const id of c.picked ?? (c.dishes ?? []).map((d) => d.id)) if (live.has(id)) picked.set(id, true);
          nameInput.value = c.name;
          syncDraft();
          render();
        };
        acts.appendChild(edit);
        const del = el('button', null, confirmId === c.id ? t.comboConfirmRemove : t.comboRemove);
        del.onclick = () => {
          if (!alive() || busy()) return;
          if (confirmId !== c.id) { confirmId = c.id; render(); return; }
          void writeAction('remove', [c.id]);
        };
        acts.appendChild(del);
      }
      card.appendChild(acts);
      return card;
    }
    function buildZone() {
      const box = el('div', 'feast-build');
      box.appendChild(el('div', 'feast-block-t', editing ? `${t.comboEdit} · ${t.comboBuild}` : t.comboBuild));
      const bar = el('div', 'feast-build-bar');
      const catSel = el('select');
      catSel.appendChild(option(t.allCats, ''));
      for (const c of data?.categories ?? []) catSel.appendChild(option(c, c));
      catSel.value = build.filter.category ?? '';
      catSel.onchange = () => {
        if (!alive() || writing) return;
        build.filter.category = catSel.value || undefined;
        const ok = build.filter.category ? (data?.categoryCuisines?.[catSel.value] ?? []) : (data?.cuisines ?? []);
        if (build.filter.cuisine && !ok.includes(build.filter.cuisine)) build.filter.cuisine = undefined;
        shown = PAGE;
        render({ resetPick: true });
      };
      bar.appendChild(catSel);
      const cuiSel = el('select');
      cuiSel.appendChild(option(t.allCuisines, ''));
      const cuisines = build.filter.category ? (data?.categoryCuisines?.[build.filter.category] ?? []) : (data?.cuisines ?? []);
      for (const c of cuisines) cuiSel.appendChild(option(c, c));
      cuiSel.value = build.filter.cuisine ?? '';
      cuiSel.onchange = () => {
        if (!alive() || writing) return;
        build.filter.cuisine = cuiSel.value || undefined;
        shown = PAGE;
        render({ resetPick: true });
      };
      bar.appendChild(cuiSel);
      bar.appendChild(searchInput);
      box.appendChild(bar);
      const list = (data?.items ?? []).filter((d) => {
        if (build.filter.category && d.category !== build.filter.category) return false;
        if (build.filter.cuisine && d.cuisine !== build.filter.cuisine) return false;
        if (build.q && !([d.name, d.cuisine, d.region, ...(d.keywords ?? [])].some((value) => String(value ?? '').includes(build.q)))) return false;
        return true;
      });
      const grid = el('div', 'feast-pick');
      grid.addEventListener('scroll', onScroll, { passive: true });
      for (const d of list.slice(0, shown)) {
        const on = picked.has(d.id);
        const chip = el('button', `feast-chip${on ? ' is-on' : ''}`);
        chip.appendChild(el('span', 'feast-chip-n', `${on ? '✓ ' : ''}${d.name}`));
        chip.appendChild(el('span', 'feast-chip-m', `${d.cuisine}·${d.category}`));
        chip.onclick = () => {
          if (!alive() || busy()) return;
          if (picked.has(d.id)) picked.delete(d.id);
          else if (picked.size >= (data?.max ?? 12)) {
            toast(root, ctx, `一桌最多 ${data?.max ?? 12} 道。`, true);
            return;
          } else picked.set(d.id, true);
          syncDraft();
          render();
        };
        grid.appendChild(chip);
      }
      if (!list.length) grid.appendChild(el('div', 'feast-empty', t.empty));
      box.appendChild(grid);
      if (shown < list.length) {
        const more = el('button', null, t.more(Math.min(PAGE, list.length - shown)));
        more.onclick = () => {
          if (!alive() || busy()) return;
          shown = Math.min(list.length, shown + PAGE);
          render();
        };
        box.appendChild(more);
        box.appendChild(el('div', 'feast-count', t.shownOf(Math.min(shown, list.length), list.length)));
      }
      box.appendChild(el('div', 'feast-count', t.comboPicked(picked.size, data?.max ?? 12)));
      box.appendChild(nameInput);
      const acts = el('div', 'feast-set-acts');
      const save = el('button', 'feast-btn-primary', editing ? t.comboEdit : t.comboBuild);
      save.onclick = () => {
        const payload = { name: String(nameInput.value ?? '').trim(), dishes: [...picked.keys()] };
        if (editing) payload.id = editing;
        void writeAction('save', [payload], { clearBuilder: true });
      };
      acts.appendChild(save);
      const serveNow = el('button', null, t.comboServe);
      serveNow.onclick = () => {
        if (!alive() || busy()) return;
        if (!picked.size) { toast(root, ctx, t.comboNoDish, true); return; }
        const count = picked.size;
        void writeAction('serve', [{ dishes: [...picked.keys()], name: String(nameInput.value ?? '').trim() || undefined }], {
          clearBuilder: true,
          message: (r) => t.served(`${r.combo?.name ?? t.comboTable}（${r.dishes?.length ?? count}）`),
        });
      };
      acts.appendChild(serveNow);
      if (editing) {
        const cancel = el('button', null, t.sayCancel);
        cancel.onclick = () => {
          if (!alive() || busy()) return;
          clearDraft();
          render();
        };
        acts.appendChild(cancel);
      }
      box.appendChild(acts);
      box.appendChild(el('div', 'feast-set-d', t.comboHint));
      return box;
    }
    function render({ resetPick = false } = {}) {
      if (!alive() || !data) return;
      if (rendered) rememberBrowse();
      if (resetPick) pickScroll = 0;
      const a = root.activeElement ?? document.activeElement;
      const focusNode = (a === searchInput || a === nameInput) ? a : null;
      const focusSel = focusNode ? { start: focusNode.selectionStart, end: focusNode.selectionEnd } : null;
      wrap.replaceChildren();
      pendingBox = null;
      if (data.pending) wrap.appendChild(pendingStrip(data.pending));
      wrap.appendChild(el('div', 'feast-combo-h', t.comboPresets));
      if (data.presets?.length) for (const c of data.presets) wrap.appendChild(setCard(c, false));
      else wrap.appendChild(el('div', 'feast-empty', t.comboEmpty));
      wrap.appendChild(el('div', 'feast-combo-h', t.comboCustom));
      if (data.custom?.length) for (const c of data.custom) wrap.appendChild(setCard(c, true));
      else wrap.appendChild(el('div', 'feast-empty', t.comboNone));
      wrap.appendChild(el('div', 'feast-combo-h', t.comboBuild));
      wrap.appendChild(buildZone());
      syncBusy();
      if (focusNode) {
        try { focusNode.focus({ preventScroll: true }); } catch { /* Older hosts may not retain focus. */ }
        if (typeof focusSel?.start === 'number') {
          try { focusNode.setSelectionRange(focusSel.start, focusSel.end); } catch { /* Ignore a stale cursor range. */ }
        }
      }
      setViewScrollTop(root, wrap, outerScroll);
      const pick = wrap.querySelector('.feast-pick');
      if (pick) pick.scrollTop = pickScroll;
      rendered = true;
      rememberBrowse(false);
    }
    function dispose() {
      if (disposed) return;
      if (rendered) rememberBrowse();
      disposed = true;
      request++;
      ticker?.dispose?.();
      for (const node of scrollNodes) node.removeEventListener('scroll', onScroll);
      ctx.signal?.removeEventListener?.('abort', dispose);
    }
    ctx.signal?.addEventListener?.('abort', dispose, { once: true });
    await refresh();
    if (alive()) {
      // Retain the pre-existing waiting-strip ticker; no new polling timer is added.
      ticker = ctx.interval?.(() => {
        if (!alive() || !pendingBox) return;
        const left = remainMin(pendingBox.p);
        if (left <= 0) {
          pendingBox.el.textContent = t.pendingGone;
          pendingBox = null;
          return;
        }
        pendingBox.el.textContent = t.pendingLeft(left);
      }, 20_000);
    }
    return { dispose };
  },
};

export default { panels: { menu: menuPanel, combo: comboPanel, history: historyPanel, today: todayPanel } };
