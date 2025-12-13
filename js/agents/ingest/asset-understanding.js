export async function understandAsset(asset, { visionApi, modelRouter } = {}) {
  if (!asset?.data || !asset?.type) return null;

  const callVision = modelRouter?.call
    ? (prompt, images) => modelRouter.call(prompt, { usage: "vision", images })
    : visionApi?.describe
      ? (prompt, images) => visionApi.describe(images[0], prompt)
      : null;

  if (!callVision) return null;

  const understanding = {};

  try {
    const descPrompt = "Describe this image concisely in 1-2 sentences. Focus on key content.";
    const result = await callVision(descPrompt, [asset.data]);
    understanding.description = result?.content || result;
  } catch (e) {
    understanding.descriptionError = e instanceof Error ? e.message : String(e);
  }

  if (asset.type === "image" || asset.type === "diagram" || asset.type === "table") {
    try {
      const ocrPrompt = "Extract all visible text from this image. Return only the text, no description.";
      const result = await callVision(ocrPrompt, [asset.data]);
      understanding.ocrText = result?.content || result;
    } catch (e) {
      understanding.ocrError = e instanceof Error ? e.message : String(e);
    }
  }

  if (asset.type === "table") {
    try {
      const tablePrompt = "This is a table. Extract its data as JSON array of rows.";
      const result = await callVision(tablePrompt, [asset.data]);
      const text = result?.content || result || "";
      const jsonMatch = String(text).match(/\[[\s\S]*\]/);
      if (jsonMatch) understanding.dataTable = JSON.parse(jsonMatch[0]);
    } catch (e) {
      understanding.tableError = e instanceof Error ? e.message : String(e);
    }
  }

  if (asset.type === "formula") {
    try {
      const formulaPrompt = "Convert this mathematical formula to LaTeX. Return only the LaTeX code.";
      const result = await callVision(formulaPrompt, [asset.data]);
      understanding.formulaLatex = result?.content || result;
    } catch (e) {
      understanding.formulaError = e instanceof Error ? e.message : String(e);
    }
  }

  return understanding;
}

export async function understandAssets(assets, options = {}) {
  const { concurrency = 3, onProgress } = options;
  const list = Array.isArray(assets) ? assets : [];
  const results = [];

  const batchSize = Math.max(1, Math.floor(Number(concurrency) || 1));
  for (let i = 0; i < list.length; i += batchSize) {
    const batch = list.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((asset) => understandAsset(asset, options).catch((e) => ({ error: e.message }))));
    results.push(...batchResults);
    onProgress?.({ processed: results.length, total: list.length });
  }

  return results;
}
