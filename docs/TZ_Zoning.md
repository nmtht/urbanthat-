# ТЗ — Спринт 4: Зонирование и генерация застройки

**Проект:** Urban That  
**Ветка:** `sprint-4-zoning` (от `sprint-3-road-brush`)  
**Срок ориентир:** 1 спринт  
**Зависимости:** Road Brush MVP, зоны (rect/poly/freehand), Inspector (FAR / buildForm / floors / coverage), Scene stats, Model quality  

---

## 1. Цель

Дать проектировщику цикл **нарисовал зоны → задал параметры → получил массовую застройку**, которую можно править точечно, с undo и без обязательного OSM. Визуальный язык — «если Apple сделали City Skylines»: чистый massing, читаемые кварталы, без шума.

---

## 2. Out of scope (этот спринт)

- Реалистичные фасады / окна на *сгенерированных* зданиях сверх текущего High quality (достаточно massing + этажные пояса).
- Транспортные симуляции, парковка как сеть, агенты.
- Экспорт IFC / BIM, коллаборация.
- Автоматическая разбивка по кадастру / реальным ПЗЗ.
- iPad / touch-first UX.

---

## 3. Модель данных

### 3.1 Zone (расширение текущего `ZoneRect`)

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | string | Уже есть |
| `type` | residential / commercial / industrial / park / boundary | Boundary — только контур, не генерирует здания |
| `polygon` / bbox | | Уже есть |
| `name` | string? | Уже есть |
| `buildForm` | block / tower / random / corridor / open | Уже в Inspector |
| `far` | number? | Floor Area Ratio, целевой |
| `maxFloors` | number? | Жёсткий потолок этажности |
| `coverage` | number? 0–1 | Доля пятна застройки от площади зоны |
| `setbackM` | number? | Отступ от границы зоны / дороги (default 3–6) |
| `parcelDepthM` | number? | Глубина участка от фронта (для block/corridor) |
| `seed` | number? | Детерминированный RNG |

**Boundary:** не участвует в генерации; используется для Scene stats и (позже) clip.

### 3.2 GeneratedBuilding

```ts
interface GeneratedBuilding {
  id: string;
  zoneId: string;
  footprint: Point2D[];   // local XY
  heightM: number;
  floors: number;
  type: ZoneType;        // наследует зону (кроме park)
  buildForm: ZoneBuildForm;
}
```

Хранение: массив в App state + CommandStack (`GenerateZoneCommand` / `ClearZoneBuildingsCommand` / `DeleteBuildingCommand`).

### 3.3 Правила по типу зоны (defaults)

| Type | FAR | Coverage | Max floors | Form |
|------|-----|----------|------------|------|
| residential | 1.5–2.5 | 0.35–0.55 | 6–12 | block |
| commercial | 2.0–4.0 | 0.5–0.7 | 8–20 | block / tower |
| industrial | 0.8–1.5 | 0.4–0.6 | 2–4 | open / corridor |
| park | — | 0 | 0 | open (деревья/площадки позже) |
| boundary | — | — | — | нет генерации |

Inspector может переопределить.

---

## 4. Пайплайн генерации

```
Zone polygon
  → inset by setbackM (Clipper2 / pure offset)
  → optional street frontage detection (user roads + OSM roads near edge)
  → parcelize (по buildForm)
  → footprint per parcel (coverage, min size)
  → height from FAR: height ≈ (FAR * parcelArea / footprintArea) * floorH
  → clamp maxFloors
  → emit GeneratedBuilding[]
  → UserBuildingsLayer (extrude + quality-aware materials)
```

### 4.1 Parcelization по `buildForm`

| Form | Алгоритм (MVP) |
|------|----------------|
| **block** | Сетка вдоль длинной оси / фронта улицы; ряды глубиной `parcelDepthM`; внутренний двор если зона > порога |
| **tower** | 1–N башен в центрах ячеек; большое open space |
| **random** | Poisson-disk точки + прямоугольные footprints со случайным поворотом ±15° |
| **corridor** | Полосы вдоль длинной стороны, непрерывные объёмы |
| **open** | 0 зданий (парк / void) |

Минимальный footprint: ~8×8 м residential, ~12×12 commercial, ~20×15 industrial.

### 4.2 Clip / конфликты

- Не ставить здания поверх user roads / OSM roads (buffer ~ half road width + 1 м).
- Не пересекать другие зоны другого типа (опционально soft).
- Park / boundary / water (OSM) — запрет.

### 4.3 Детерминизм

Один `seed` на зону → повтор Generate даёт тот же результат. Смена seed в Inspector → «перекинуть».

---

## 5. UI / UX

### 5.1 Генерация

- В Inspector зоны (не boundary, не park-open): кнопка **Generate** / **Regenerate** / **Clear buildings**.
- Горячая клавиша: `G` при выбранной зоне.
- Статус: «12 buildings · FAR fact 2.1 / target 2.5».

### 5.2 Выделение и правка

- Клик по сгенерированному зданию → Inspector (высота, этажи, удалить).
- Esc снимает выделение (зоны, здания, дороги).
- Delete / Backspace — удалить здание или зону.

### 5.3 Слои качества

| Quality | Generated buildings |
|---------|---------------------|
| Low | Solid massing |
| Med | Floor bands |
| High | Floor bands + optional simple window shader |

### 5.4 Boundary

- Только контур, без заливки.
- Не перекрывает pick внутренних зон.

---

## 6. Команды (undo)

| Command | Do | Undo |
|---------|----|------|
| `GenerateZoneCommand` | Записать buildings[] для zoneId | Восстановить предыдущий список |
| `ClearZoneBuildingsCommand` | buildings = [] | Restore |
| `DeleteBuildingCommand` | Remove one | Restore |
| `UpdateBuildingCommand` | Patch height/floors | Restore |

---

## 7. Рендер

`src/render/UserBuildingsLayer.tsx` — extrude, materials через `getFacadeMaterial`, `userData.kind = 'user-building'`.

---

## 8. Геометрия / зависимости

- Clipper2 WASM или pure-TS offset для inset.
- Никакой серверной генерации.

---

## 9. Критерии приёмки

1. Residential zone → Generate → кварталы внутри, не на дорогах.
2. FAR / maxFloors / coverage меняют результат после Regenerate.
3. block vs tower визуально различимы.
4. Undo Generate / Delete building.
5. Boundary без заливки; зона внутри boundary выделяется.
6. Esc снимает выделение зоны и здания.
7. Park + open → 0 зданий.
8. Model quality влияет на gen-здания.
9. Работает без OSM.
10. ~50–100 зданий без фризов.

---

## 10. Порядок внедрения

1. Data + commands
2. Parcelize MVP — block + open
3. UserBuildingsLayer + pick/inspector
4. Tower / random / corridor
5. Road buffer exclusion
6. Polish — seeds, stats, edge cases

---

## 11. Риски

| Риск | Митигация |
|------|-----------|
| Сложный inset полигонов | Сначала только rect-зоны |
| Пересечение дорог | Buffer по centerline |
| Слишком плотно / редко | actual FAR; coverage |
| Vite + WASM | Pure-TS path first |
