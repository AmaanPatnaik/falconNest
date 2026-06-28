export function createInitialState() {
  return {
    parts: [],
    placements: [],
    iterations: [],
    activeIteration: -1,
    nestingProgress: 0,
    isNesting: false,
    selectedId: null,
    pan: { x: 40, y: 40 },
    zoom: 1,
    warnings: [],
    metrics: {
      sheets: 0,
      utilization: 0,
      wasteArea: 0,
      nestingTimeMs: 0,
    },
    settings: {
      displayUnits: "inch",
      sheetWidth: 48,
      sheetHeight: 96,
      materialName: "",
      spacing: 0.2,
      curveTolerance: 0.01,
      partRotations: 4,
      optimizationType: "gravity",
      showGrid: true,
      snapGrid: false,
      showBounds: true,
    },
  };
}

export const state = createInitialState();

export function resetProject() {
  const fresh = createInitialState();
  Object.assign(state, fresh);
}
