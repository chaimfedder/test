# תבנית פנימית לכובע – גיליון קרטון אחד (אב טיפוס)

כל המידות נובעות מ־`params.json` (מ״מ). שינוי פרמטר ← הרצה מחדש של השלבים:

```
python3 checks.py          # בדיקות גאומטריה -> out/checks.json
python3 layout.py          # פריסה: out/dieline.svg, out/dieline.dxf, out/layout_preview.png
python3 diagrams.py        # חתך והשוואת כיוונים
python3 anim_checks.py     # בדיקת התנגשויות בכל פריים של האנימציה
python3 render_anim.py     # רינדור (Blender/bpy, Cycles)
python3 compose.py         # עריכה, כתוביות וקריינות -> out/hat_insert_explainer.mp4
python3 pdf_pack.py        # PDF פריסה + שלבים + דוח
python3 save_blend.py      # out/hat_insert_model.blend
```

קבצים עיקריים: `model.py` (פריסה, צירי קיפול, כובע), `anim.py` (רצף ההרכבה), `narration.json` (תסריט).
