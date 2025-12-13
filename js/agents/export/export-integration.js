const SCHEMA_VERSION = "0.1";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function nowIso() {
  return new Date().toISOString();
}

function getSlideParser() {
  const sp = globalThis?.SlideParser;
  if (!sp || typeof sp.parse !== "function") throw new Error("SlideParser.parse is not available (expected globalThis.SlideParser)");
  return sp;
}

async function maybeAwait(v) {
  return v && typeof v.then === "function" ? await v : v;
}

async function exportPptxWithRenderer(slides, { filename = "presentation.pptx", rendererOptions } = {}) {
  const PptxGenJS = globalThis?.PptxGenJS;
  const Renderer = globalThis?.PPTXSlideRenderer;
  if (!PptxGenJS) throw new Error("PptxGenJS is not available");
  if (!Renderer) throw new Error("PPTXSlideRenderer is not available");

  const renderer = new Renderer(rendererOptions || {});
  let capturedBlob = null;
  if (renderer && typeof renderer._downloadBlob === "function") {
    renderer._downloadBlob = (blob) => {
      capturedBlob = blob;
    };
  }

  await renderer.render(slides, filename);
  if (!capturedBlob) throw new Error("PPTX export did not produce a blob");
  return { blob: capturedBlob, bytes: typeof capturedBlob.size === "number" ? capturedBlob.size : undefined };
}

async function exportImagesWithHtml2Canvas(slides, { scale = 1 } = {}) {
  const html2canvas = globalThis?.html2canvas;
  const HTMLSlideRenderer = globalThis?.HTMLSlideRenderer;
  const document = globalThis?.document;
  if (typeof html2canvas !== "function") throw new Error("html2canvas is not available");
  if (!HTMLSlideRenderer) throw new Error("HTMLSlideRenderer is not available");
  if (!document || typeof document.createElement !== "function") throw new Error("DOM is not available");

  const renderer = new HTMLSlideRenderer();
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-9999px;top:0;width:960px;height:540px;z-index:-9999;";
  document.body.appendChild(container);

  try {
    // Minimal proof: if we can export one slide, the pipeline works.
    const images = [];
    const max = Math.min(slides.length, 1);
    for (let i = 0; i < max; i++) {
      container.innerHTML = `<div style="width:960px;height:540px;overflow:hidden;background:#ffffff">${renderer.render(slides[i], i)}</div>`;
      const canvas = await html2canvas(container.firstChild, { scale, backgroundColor: "#ffffff", logging: false });
      images.push(canvas.toDataURL("image/png"));
      canvas.width = 0;
      canvas.height = 0;
    }
    return { images, count: images.length };
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * Export integration layer (agents): parse deckHtmlDsl then export formats.
 *
 * @param {object} deckPackage
 * @param {object=} options
 * @returns {Promise<object>} ExportResult (also suitable as export_report.json)
 */
export async function runExport(deckPackage, options = {}) {
  const runId = String(options?.runId || deckPackage?.runId || "run_unknown");

  if (isPlainObject(options?.mock)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      runId,
      createdAt: nowIso(),
      slidesCount: Number(options.mock?.slidesCount ?? 0) || 0,
      formats: isPlainObject(options.mock?.formats) ? options.mock.formats : {},
      ...(isPlainObject(options.mock?.notes) ? { notes: options.mock.notes } : {}),
    };
  }

  const formatsWanted = {
    pptx: options?.formats?.pptx !== false,
    pdf: !!options?.formats?.pdf,
    images: options?.formats?.images !== false, // default on (G3 can use images when pdf isn't supported)
  };

  let slides = Array.isArray(options?.slides) ? options.slides : null;
  let parseError = null;
  if (!slides) {
    try {
      slides = getSlideParser().parse(deckPackage?.deckHtmlDsl);
    } catch (e) {
      slides = [];
      parseError = String(e?.message || e);
    }
  }

  const exporters = isPlainObject(options?.exporters) ? options.exporters : {};
  const includeBlobs = !!options?.includeBlobs;

  const out = {
    schemaVersion: SCHEMA_VERSION,
    runId,
    createdAt: nowIso(),
    slidesCount: slides.length,
    ...(parseError ? { parseError } : {}),
    formats: {},
  };

  if (parseError) {
    // If parsing failed, exporting any format is expected to fail too.
    out.formats.pptx = { success: false, error: `parse_failed: ${parseError}` };
    out.formats.pdf = { success: false, error: `parse_failed: ${parseError}` };
    out.formats.images = { success: false, error: `parse_failed: ${parseError}` };
    return out;
  }

  // PPTX
  if (formatsWanted.pptx) {
    const t0 = Date.now();
    try {
      const res = exporters.pptx
        ? await maybeAwait(exporters.pptx({ slides, deckPackage, options }))
        : await exportPptxWithRenderer(slides, { filename: options?.pptxFilename || "presentation.pptx", rendererOptions: options?.rendererOptions });
      out.formats.pptx = {
        success: true,
        durationMs: Date.now() - t0,
        ...(typeof res?.bytes === "number" ? { bytes: res.bytes } : {}),
        ...(includeBlobs && res?.blob ? { blob: res.blob } : {}),
      };
    } catch (e) {
      out.formats.pptx = { success: false, durationMs: Date.now() - t0, error: String(e?.message || e) };
    }
  } else {
    out.formats.pptx = { success: false, skipped: true };
  }

  // PDF (optional; may be provided by an injected exporter)
  if (formatsWanted.pdf) {
    const t0 = Date.now();
    try {
      const res = exporters.pdf ? await maybeAwait(exporters.pdf({ slides, deckPackage, options })) : null;
      if (!res) throw new Error("No PDF exporter provided");
      out.formats.pdf = { success: true, durationMs: Date.now() - t0, ...(typeof res?.bytes === "number" ? { bytes: res.bytes } : {}) };
    } catch (e) {
      out.formats.pdf = { success: false, durationMs: Date.now() - t0, error: String(e?.message || e) };
    }
  } else {
    out.formats.pdf = { success: false, skipped: true };
  }

  // Images (best-effort, supports injected exporter or html2canvas)
  if (formatsWanted.images) {
    const t0 = Date.now();
    try {
      const res = exporters.images
        ? await maybeAwait(exporters.images({ slides, deckPackage, options }))
        : await exportImagesWithHtml2Canvas(slides, { scale: options?.imageScale ?? 1 });
      out.formats.images = {
        success: true,
        durationMs: Date.now() - t0,
        ...(typeof res?.count === "number" ? { count: res.count } : {}),
        ...(includeBlobs && Array.isArray(res?.images) ? { images: res.images } : {}),
      };
    } catch (e) {
      out.formats.images = { success: false, durationMs: Date.now() - t0, error: String(e?.message || e) };
    }
  } else {
    out.formats.images = { success: false, skipped: true };
  }

  return out;
}

export const ExportIntegrationConstants = {
  SCHEMA_VERSION,
};
