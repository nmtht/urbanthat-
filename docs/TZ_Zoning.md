# ТЗ — Спринт 4: Зонирование и генерация застройки

**Проект:** Urban That  
**Ветка:** `sprint-4-zoning` (от `sprint-3-road-brush`)  
**Зависимости:** Road Brush MVP, зоны (rect/poly/freehand), Inspector (FAR / buildForm / floors / coverage), Scene stats, Model quality

---

## 1. Цель

Дать проектировщику цикл **нарисовал зоны → задал параметры → получил массовую застройку**, которую можно править точечно, с undo и без обязательного OSM. Визуальный язык — «если Apple сделали City Skylines»: чистый massing, читаемые кварталы.

---

## 2. Out of scope

- Реалистичные фасады gen-зданий сверх текущего High quality
- Транспортные симуляции, агенты
- Экспорт IFC / BIM, коллаборация
- Авторазбивка по кадастру / реальным ПЗЗ
- iPad / touch-first

---

## 3. Модель данных

### 3.1 Zone (расширение `ZoneRect`)

| Поле | Тип | Описание |
|------|-----|----------|
| id, type, polygon/bbox, name | | Уже есть |
| buildForm | block / tower / random / corridor / open | Inspector |
| far | number? | Floor Area Ratio |
| maxFloors | number? | Потолок этажности |
| coverage | number? 0–1 | Доля пятна |
| setbackM | number? | Отступ от края / дороги |
| parcelDepthM | number? | Глубина участка |
| seed | number? | Детерминированный RNG |

**Boundary:** только контур, без генерации зданий.  
**Park + open:** 0 зданий.

### 3.2 GeneratedBuilding

```ts
interface GeneratedBuilding {
  id: string;
  zoneId: string;
  footprint: Point2D[];
  heightM: number;
  floors: number;
  type: ZoneType;
  buildForm: ZoneBuildForm;
}
```

State в App + CommandStack.

### 3.3 Defaults по типу

| Type | FAR | Coverage | Max floors | Form |
|------|-----|----------|------------|------|
| residential | 1.5–2.5 | 0.35–0.55 | 6–12 | block |
| commercial | 2.0–4.0 | 0.5–0.7 | 8–20 | block / tower |
| industrial | 0.8–1.5 | 0.4–0.6 | 2–4 | open / corridor |
| park | — | 0 | 0 | open |
| boundary | — | — | — | нет gen |

---

## 4. Пайплайн генерации

```
Zone polygon
  → inset setbackM
  → frontage (user + OSM roads)
  → parcelize(buildForm)
  → footprint (coverage, min size)
  → height from FAR, clamp maxFloors
  → GeneratedBuilding[]
  → UserBuildingsLayer
```

### Parcelization

| Form | MVP |
|------|-----|
| block | Сетка вдоль фронта, parcelDepthM, двор если зона большая |
| tower | 1–N башен, open space |
| random | Poisson-disk + прямоугольники ±15° |
| corridor | Полосы вдоль длинной стороны |
| open | 0 зданий |

Исключения: buffer дорог, water/park/boundary.

Детерминизм: `seed` на зону.

---

## 5. UI / UX

- Inspector: **Generate / Regenerate / Clear buildings**, hotkey `G`
- Статус: built GFA vs target FAR
- Клик по gen-зданию → Inspector (высота, удалить)
- Esc снимает выделение; Delete удаляет
- Model quality Low/Med/High применяется к gen-зданиям
- Boundary без заливки — внутренние зоны кликабельны

---

## 6. Команды undo

`GenerateZoneCommand`, `ClearZoneBuildingsCommand`, `DeleteBuildingCommand`, `UpdateBuildingCommand`.

---

## 7. Рендер

`src/render/UserBuildingsLayer.tsx` — extrude, `getFacadeMaterial`, `kind: 'user-building'`, pickable.

---

## 8. Приёмка

1. Residential zone → Generate → кварталы внутри, не на дорогах
2. FAR / floors / coverage меняют результат
3. block vs tower различимы
4. Undo Generate / Delete building
5. Boundary без заливки; зона внутри выделяется
6. Esc снимает selection
7. Park open → 0 зданий
8. Quality влияет на gen-здания
9. Работает без OSM
10. ~50–100 зданий без фризов

---

## 9. Порядок работ

1. Data + commands  
2. Parcelize block + open  
3. UserBuildingsLayer + pick  
4. Tower / random / corridor  
5. Road buffer exclusion  
6. Seeds, stats, polish  

---

## 10. Риски

- Сложный inset → сначала rect-зоны  
- WASM Clipper → pure-TS fallback  
- Плотность → показывать actual FAR  
