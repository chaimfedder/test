"""PDF: die-line, assembly steps, section, options, and a short test report. All numbers from checks.json."""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.backends.backend_pdf import PdfPages
from PIL import Image

import anim

HERE = Path(__file__).parent
OUT = HERE / "out"
FR = OUT / "frames"
for w in ("400", "700"):
    font_manager.fontManager.addfont(str(HERE / "fonts" / f"Heebo-{w}.ttf"))
plt.rcParams["font.family"] = "Heebo"
C = json.load(open(OUT / "checks.json"))
A = json.load(open(OUT / "anim_checks.json"))
D, p = C["derived"], C["params"]
H, PL = C["heights_mm"], C["plan_mm"]


def img_page(pdf, path, title, note=None):
    fig = plt.figure(figsize=(16.54, 11.69))
    fig.text(0.97, 0.965, title, ha="right", va="top", fontsize=22, weight=700)
    if note:
        fig.text(0.97, 0.93, note, ha="right", va="top", fontsize=13, color="#a00")
    ax = fig.add_axes((0.02, 0.02, 0.96, 0.88))
    ax.imshow(Image.open(path))
    ax.axis("off")
    pdf.savefig(fig)
    plt.close(fig)


def last(shot):
    fs = sorted((FR / shot).glob("*.png"))
    return fs[-1] if fs else None


def frame_at(shot, t):
    fs = sorted((FR / shot).glob("*.png"))
    i = min(int(t * anim.FPS_RENDER), len(fs) - 1)
    return fs[i]


def steps_page(pdf):
    steps = [
        (frame_at("legs", 0), "0. מגיעה שטוחה – גיליון אחד"),
        (last("legs"), "1. ארבע רגליים מתקפלות למטה (4 קיפולים) – המשטח עולה ל־9 ס״מ"),
        (last("walls"), "2. מרימים דפנות 1 ו־3, אחר כך 2 ו־4 (4 קיפולים, קיפול כפול בתחתית)"),
        (last("locks"), "3. ארבע שפות פינה נסגרות על לשוניות הדפנות הארוכות (4 קיפולים)"),
        (last("risers"), "4. ארבע תמיכות: מרימים, מקפלים חוץ ומטה, לשונית לחריץ (12 קיפולים)"),
        (FR / "cutaway" / "0000.png", "5. הכובע הפוך: נשען על קודקודי התמיכות (תצוגת הסבר, דופן 3 מוסתרת)"),
    ]
    fig = plt.figure(figsize=(16.54, 11.69))
    fig.text(0.97, 0.965, "שלבי הרכבה – 24 פעולות קיפול, בלי דבק ובלי כלים", ha="right", va="top", fontsize=22, weight=700)
    for i, (f, cap) in enumerate(steps):
        r, c = divmod(i, 2)
        x = 0.51 if c == 0 else 0.02
        y = 0.64 - r * 0.31
        ax = fig.add_axes((x, y, 0.47, 0.27))
        if f and Path(f).exists():
            ax.imshow(Image.open(f))
        ax.axis("off")
        fig.text(x + 0.47, y - 0.005, cap, ha="right", va="top", fontsize=12.5)
    pdf.savefig(fig)
    plt.close(fig)


def report_page(pdf):
    fig = plt.figure(figsize=(11.69, 16.54))
    lines = [
        ("דוח בדיקות קצר – תבנית פנימית לכובע (אב טיפוס)", 20, 700),
        ("", 8, 400),
        ("המבנה שנבחר: כיוון ג – משטח בגובה 9 ס״מ על ארבע רגליים, וארבעה משולשים נעולים בגובה 3 ס״מ.", 13, 400),
        ("הסיבה: המשולש נעול בחריץ ואינו נשען על קפיציות; החומר שלו יוצא מהחור המרכזי; נשאר חלל 3 ס״מ מתחת לנקודת התמיכה לשוליים.", 13, 400),
        ("כיוון א נפסל: תמיכה חופשית 8 ס״מ, אין חומר לנעילה. כיוון ב נפסל: שוליים שמתעקלים למטה נלחצים על משטח בגובה 12.", 13, 400),
        ("", 8, 400),
        ("מספר פעולות: 4 רגליים + 4 דפנות + 4 שפות פינה + 12 בתמיכות (3 לכל אחת) = 24. אין הדבקה ואין כלים.", 13, 700),
        ("", 8, 400),
        (f"פתח ראש מחושב: {PL['head_opening'][0] / 10:.2f} × {PL['head_opening'][1] / 10:.2f} ס״מ (היקף {PL['head_perimeter_check'] / 10:.1f} ס״מ, הפרש 4 ס״מ).", 13, 400),
        (f"מעטפת כתר (הנחה +2 מ״מ לצד): {PL['crown_envelope'][0] / 10:.2f} × {PL['crown_envelope'][1] / 10:.2f} ס״מ · מעטפת שוליים: {PL['brim_envelope'][0] / 10:.2f} × {PL['brim_envelope'][1] / 10:.2f} ס״מ.", 13, 400),
        (f"פתח מרכזי: {PL['hole'][0] / 10:.1f} × {PL['hole'][1] / 10:.1f} ס״מ · מרווח מינימלי כתר–פתח: {PL['crown_to_hole_min_gap']:.1f} מ״מ.", 13, 400),
        (f"גבהים: משטח {H['deck_top']:.0f} · מגע {H['support_contact']:.0f} · מסגרת {H['frame_top_short']:.0f} מ״מ (לשוניות נעילה עד {H['frame_top_long_incl_lock_tabs']:.1f}).", 13, 400),
        (f"קצה הכתר: {H['crown_tip_lowest']:.1f} מ״מ מעל התחתית (יעד ≥ 15) · שוליים מעל המשטח: {H['brim_lowest_minus_deck']:.1f} מ״מ · מסגרת מעל השוליים: {H['frame_top_minus_brim_highest']:.1f} מ״מ.", 13, 400),
        (f"מרווח שוליים–דפנות: {PL['brim_to_wall_x']:.1f} מ״מ לאורך, {PL['brim_to_wall_y']:.1f} מ״מ לרוחב.", 13, 400),
        (f"תבנית מורכבת: {PL['template_outer'][0] / 10:.1f} × {PL['template_outer'][1] / 10:.1f} × {D['Hf'] / 10:.1f} ס״מ · גיליון שטוח: {C['flat']['sheet_bbox_mm'][0] / 10:.1f} × {C['flat']['sheet_bbox_mm'][1] / 10:.1f} ס״מ.", 13, 700),
        (f"שקית (נגזרת מהתבנית): חלל לפחות {C['bag_min_inner_mm'][0] / 10:.1f} × {C['bag_min_inner_mm'][1] / 10:.1f} ס״מ, גובה שימושי 15 ס״מ; בסרטון 36 × 33 × 15.", 13, 700),
        (f"שטח החלק: {C['flat']['part_area_m2']:.3f} מ״ר · פחת מהחור (מוסר במפעל): {C['flat']['factory_waste_hole_m2']:.3f} מ״ר.", 13, 400),
        ("", 8, 400),
        ("נבדק במודל (גאומטריה בלבד):", 15, 700),
        (f"• הפריסה היא חלק מחובר אחד: {'כן' if C['flat']['single_piece'] else 'לא'} · חפיפה בין משטחים בפריסה: {C['flat']['max_panel_overlap_mm2']} מ״מ².", 13, 400),
        (f"• מידות המשטחים קבועות בקיפול (שינוי מרבי באורך צלע: {C['rigid_panels_max_edge_change_mm']:.1e} מ״מ).", 13, 400),
        ("• אין התנגשויות במצב המורכב, עם הכובע ובלעדיו.", 13, 400),
        (f"• מסלול הורדת הכובע (200 מ״מ אנכית): {len(C['hat_insertion_collisions'])} התנגשויות.", 13, 400),
        ("• כל פריים בסרטון נבדק להתנגשויות ולחדירה לרצפה: " + ", ".join(f"{k} {v['frames_with_collision']}/{v['frames']}" for k, v in A.items()), 11, 400),
        (f"• נעילות: מרכז חריץ השפה מול מרכז הלשונית – סטייה {max(C['rim_slot_to_tab_offset_mm']):.2f} מ״מ; חריץ 2.5 × 11 מ״מ, לשונית עם אוזניים 11.2 מ״מ (נכנסת בכיפוף מקומי של האוזניים).", 13, 400),
        (f"• תמיכות א ו־ג נוגעות בשוליים; ב ו־ד נמוכות בכ־0.3–0.6 מ״מ בגלל קימור השוליים (בתוך סבולת הקרטון).", 13, 400),
        ("", 8, 400),
        ("צריך לבדוק בדגם פיזי (לא הוכח במודל):", 15, 700),
        ("• חוזק ויציבות בנשיאה ובטלטול · עייפות הקיפולים אחרי פתיחות חוזרות · אחיזת הלשוניות בחריצים בעובי האמיתי.", 13, 400),
        ("• לחץ על הכובע בנקודות המגע · מדידות הכובע האמיתי: רוחב כתר מרבי, פרופיל, עובי, וקימור השוליים.", 13, 400),
        ("", 8, 400),
        ("הנחות שניתנות לשינוי בקובץ params.json:", 15, 700),
        (f"עובי קרטון {p['board_thickness']} מ״מ (ניסיוני) · תוספת כתר {p['crown_ease_per_side']} מ״מ לצד · קימור שוליים: ירידה {p['brim_side_drop']} מ״מ בצדדים, עלייה {p['brim_front_rise']} מ״מ מלפנים ומאחור.", 13, 400),
    ]
    y = 0.96
    for s, sz, wt in lines:
        fig.text(0.95, y, s, ha="right", va="top", fontsize=sz, weight=wt, wrap=True)
        y -= 0.012 + sz * 0.0019
    pdf.savefig(fig)
    plt.close(fig)


if __name__ == "__main__":
    with PdfPages(OUT / "hat_insert_layout_and_assembly.pdf") as pdf:
        img_page(pdf, OUT / "layout_preview.png", "פריסה שטוחה – קווי חיתוך וקיפול", "אב טיפוס – לא לייצור. קובץ וקטורי: dieline.svg / dieline.dxf (1:1, מ״מ)")
        steps_page(pdf)
        img_page(pdf, OUT / "section.png", "חתך וגבהים (מהמודל)")
        img_page(pdf, OUT / "compare.png", "השוואת כיוונים")
        report_page(pdf)
    print("ok")
