import test from "node:test";
import assert from "node:assert/strict";

import {
  applyOrderedIdsToCategoria,
  groupPlatosByCategoria,
  shouldSkipDragUpdate,
} from "./platos.utils.js";

test("groupPlatosByCategoria agrupa por categoria preservando categorias vacías", () => {
  const categorias = [{ id: 1 }, { id: 2 }];
  const platos = [
    { id: "a", categoria_id: 1, orden: 1 },
    { id: "b", categoria_id: 1, orden: 2 },
  ];

  const grouped = groupPlatosByCategoria(platos, categorias);

  assert.equal(grouped.get("1").length, 2);
  assert.equal(grouped.get("2").length, 0);
});

test("applyOrderedIdsToCategoria actualiza solo la categoría objetivo", () => {
  const platos = [
    { id: "a", categoria_id: 1, orden: 1 },
    { id: "b", categoria_id: 1, orden: 2 },
    { id: "c", categoria_id: 2, orden: 1 },
  ];

  const updated = applyOrderedIdsToCategoria(platos, 1, ["b", "a"]);

  assert.equal(updated.find(p => p.id === "b").orden, 1);
  assert.equal(updated.find(p => p.id === "a").orden, 2);
  assert.equal(updated.find(p => p.id === "c").orden, 1);
});

test("applyOrderedIdsToCategoria no modifica cuando orderedIds está vacío", () => {
  const platos = [
    { id: "a", categoria_id: 1, orden: 1 },
    { id: "b", categoria_id: 1, orden: 2 },
  ];

  const updated = applyOrderedIdsToCategoria(platos, 1, []);

  assert.equal(updated, platos);
});

test("shouldSkipDragUpdate cubre casos de guardia", () => {
  assert.equal(
    shouldSkipDragUpdate({ busy: true, oldIndex: 0, newIndex: 1, orderedIds: ["a"] }),
    true
  );
  assert.equal(
    shouldSkipDragUpdate({ busy: false, oldIndex: 0, newIndex: 0, orderedIds: ["a"] }),
    true
  );
  assert.equal(
    shouldSkipDragUpdate({ busy: false, oldIndex: 0, newIndex: 1, orderedIds: [] }),
    true
  );
  assert.equal(
    shouldSkipDragUpdate({ busy: false, oldIndex: 0, newIndex: 1, orderedIds: ["a"] }),
    false
  );
});
