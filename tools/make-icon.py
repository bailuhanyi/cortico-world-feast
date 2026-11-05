"""
生成扩展图标 assets/icon.png（512×512，市场要求 ≤512KB）。

画意：一只白瓷碗，碗口里是白饭、红油和一叶青菜，上面飘三缕热气。
配色取 Coo 主题的薄荷绿 #00a870 作底，缩到 64px 也还认得出是个碗。

约定：所有坐标都写在 512 的坐标系里，统一由 S() 乘上超采样倍数再画，
最后缩回 512 —— 这样写法直观，边缘又由 LANCZOS 磨平。

用法：python tools/make-icon.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'icon.png'
SIZE = 512
SS = 4                       # 超采样倍数
N = SIZE * SS

MINT = (0, 168, 112)
CREAM = (255, 255, 255)
BOWL = (252, 252, 250)
BOWL_SHADE = (229, 233, 228)
BOWL_EDGE = (203, 210, 205)
RICE = (247, 244, 235)
RICE_DOT = (231, 226, 211)
RED_OIL = (211, 79, 54)
RED_OIL_DARK = (176, 60, 41)
GREENS = (84, 155, 95)
GREENS_DARK = (60, 124, 73)


def S(v):
    """512 坐标系 → 超采样画布坐标。"""
    return int(round(v * SS))


def main():
    img = Image.new('RGB', (N, N), MINT)
    d = ImageDraw.Draw(img)

    # 底色：极淡的竖向渐变，免得整块死板
    for y in range(N):
        t = y / N
        d.line([(0, y), (N, y)], fill=tuple(int(c * (1 - 0.09 * t)) for c in MINT))

    # ---- 碗的几何（512 坐标系）----
    cx = 256.0
    rim_y = 246.0            # 碗口中心
    rim_rx, rim_ry = 150.0, 45.0
    foot_y = 402.0           # 碗底
    foot_rx, foot_ry = 92.0, 26.0

    # 碗身：每条横线给出左右边界。半宽从 rim_rx 收到 foot_rx，
    # 用 0.62 次方做缓出——上半段收得快，靠近碗底收得慢，才像碗不像梯形。
    steps = 400
    for i in range(steps + 1):
        t = i / steps
        y = rim_y + (foot_y - rim_y) * t
        half = rim_rx + (foot_rx - rim_rx) * (t ** 0.62)
        d.line([(S(cx - half), S(y)), (S(cx + half), S(y))], fill=BOWL)

    # 碗底圆弧，给一点厚度
    bottom_box = (S(cx - foot_rx), S(foot_y - foot_ry * 0.62), S(cx + foot_rx), S(foot_y + foot_ry * 0.62))
    d.ellipse(bottom_box, fill=BOWL_SHADE)
    d.ellipse(bottom_box, outline=BOWL_EDGE, width=S(1.6))

    # 碗身右侧一道阴影，让它有体积
    for i in range(steps + 1):
        t = i / steps
        y = rim_y + (foot_y - rim_y) * t
        half = rim_rx + (foot_rx - rim_rx) * (t ** 0.62)
        d.line([(S(cx + half * 0.60), S(y)), (S(cx + half), S(y))], fill=BOWL_SHADE)

    # ---- 碗口里的内容：单独一层，最后按碗口椭圆裁掉边缘 ----
    food = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    fd = ImageDraw.Draw(food)

    # 白饭：占碗口左侧大半
    fd.ellipse((S(cx - rim_rx * 0.92), S(rim_y - rim_ry * 0.92),
                S(cx + rim_rx * 0.26), S(rim_y + rim_ry * 0.92)), fill=RICE)
    # 米粒：几颗浅点，暗示是饭不是一团白
    for gx in (-0.54, -0.42, -0.30, -0.18):
        for gy in (-0.34, -0.10, 0.14):
            mx, my = cx + rim_rx * gx, rim_y + rim_ry * gy
            fd.ellipse((S(mx - 3), S(my - 2), S(mx + 3), S(my + 2)), fill=RICE_DOT)

    # 红油：右侧一大摊，深边压一圈
    fd.ellipse((S(cx - rim_rx * 0.10), S(rim_y - rim_ry * 0.84),
                S(cx + rim_rx * 0.94), S(rim_y + rim_ry * 0.84)), fill=RED_OIL_DARK)
    fd.ellipse((S(cx - rim_rx * 0.02), S(rim_y - rim_ry * 0.70),
                S(cx + rim_rx * 0.86), S(rim_y + rim_ry * 0.70)), fill=RED_OIL)

    # 青菜：横搭在上沿，两片叶子
    fd.ellipse((S(cx - rim_rx * 0.50), S(rim_y - rim_ry * 1.02),
                S(cx + rim_rx * 0.12), S(rim_y - rim_ry * 0.22)), fill=GREENS_DARK)
    fd.ellipse((S(cx - rim_rx * 0.20), S(rim_y - rim_ry * 1.10),
                S(cx + rim_rx * 0.42), S(rim_y - rim_ry * 0.30)), fill=GREENS)

    rim_box = (S(cx - rim_rx), S(rim_y - rim_ry), S(cx + rim_rx), S(rim_y + rim_ry))
    mask = Image.new('L', (N, N), 0)
    ImageDraw.Draw(mask).ellipse(rim_box, fill=255)
    img.paste(food, (0, 0), Image.composite(food, Image.new('RGBA', (N, N), (0, 0, 0, 0)), mask))

    # 碗口：内外两圈，拉出瓷的厚度
    d.ellipse(rim_box, outline=BOWL_EDGE, width=S(4.5))
    d.ellipse((rim_box[0] + S(4), rim_box[1] + S(4), rim_box[2] - S(4), rim_box[3] - S(4)),
              outline=BOWL_SHADE, width=S(2.5))

    # ---- 热气：三缕，往上；底端贴近碗口，别留一段空 ----
    for ox, h in ((-0.11, 0.62), (0.0, 1.0), (0.11, 0.62)):
        x = cx + rim_rx * ox
        y1 = rim_y - rim_ry - 6
        y0 = y1 - 62 * h
        d.line([(S(x), S(y1)), (S(x), S(y0))], fill=CREAM, width=S(10))
        r = 5.0
        d.ellipse((S(x - r), S(y0 - r), S(x + r), S(y0 + r)), fill=CREAM)

    out = img.resize((SIZE, SIZE), Image.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT, 'PNG', optimize=True)
    # 控制台是 GBK，别打印对勾这类非 GBK 字符
    print(f'[ok] {OUT.relative_to(ROOT)}  {SIZE}x{SIZE}  {OUT.stat().st_size / 1024:.1f} KB')


if __name__ == '__main__':
    main()