import { getEmitFn } from "../../../runtime/core/agent-loop.js";

/**
 * runSlideFixer - 幻灯片自我修复 Agent
 * 
 * 根据 QA 发现的具体问题，对 HTML DSL 进行针对性修改。
 */
export async function runSlideFixer({
    slideIndex,
    slideIntent,
    currentHtml,
    issues,
    designSystem,
    contentPackage,
    aiApiService,
    modelRouter,
    signal,
}) {
    if (!aiApiService) return currentHtml;

    const systemPrompt = `You are a Slide Layout Fixer.
Your task is to fix specific issues in a Slide HTML DSL while keeping the content and design system tokens.

Rules:
1. Fix common issues: overflow (x/y/w/h), minimum font size (usually 12px), and contrast.
2. Maintain the data-el, data-x, data-y, data-w, data-h attributes.
3. Return ONLY the valid <section>...</section> block. Do not include markdown code fences or walk-through text.
4. If an element overflows, adjust its position (data-x, data-y) or dimensions (data-w, data-h) within 0-100 range.
5. If font is too small, increase it to at least 12px or use a smaller amount of text.
`;

    const userPrompt = `Slide Intent: ${JSON.stringify(slideIntent)}
Current HTML:
${currentHtml}

QA Issues to fix:
${JSON.stringify(issues, null, 2)}

Design System context:
${JSON.stringify(designSystem)}

Please provide the fixed HTML:`;

    try {
        const response = await aiApiService.chat({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            model: modelRouter ? modelRouter("fixer") : undefined,
            signal,
        });

        let fixedHtml = response.text || "";
        // 粗略清洗可能存在的 ```html ... ```
        fixedHtml = fixedHtml.replace(/```html/g, "").replace(/```/g, "").trim();

        if (fixedHtml.includes("<section")) {
            return fixedHtml;
        }
        return currentHtml;
    } catch (err) {
        console.error("[SlideFixer] Fix failed:", err);
        return currentHtml;
    }
}
