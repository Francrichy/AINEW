export function validateFilmRequest(body, maxScenes = 120) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body lazima iwe JSON object." };
  }
  const ownerId = String(body.ownerId || "").trim();
  const scenes = body.scenes;
  if (!ownerId || ownerId.length > 128) {
    return { ok: false, error: "ownerId inahitajika." };
  }
  if (!Array.isArray(scenes) || scenes.length < 1 || scenes.length > maxScenes) {
    return { ok: false, error: `Scenes lazima ziwe kati ya 1 na ${maxScenes}.` };
  }
  const normalized = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const prompt = String(scene?.prompt || "").trim();
    const duration = Number(scene?.duration || 15);
    const aspectRatio = ["9:16", "16:9", "1:1"].includes(scene?.aspectRatio)
      ? scene.aspectRatio : "16:9";
    if (prompt.length < 3 || prompt.length > 1600) {
      return { ok: false, error: `Prompt ya scene ${i + 1} lazima iwe herufi 3 hadi 1600.` };
    }
    if (![5, 15].includes(duration)) {
      return { ok: false, error: `Scene ${i + 1}: muda uruhusiwe ni sekunde 5 au 15.` };
    }
    normalized.push({ prompt, duration, aspectRatio });
  }
  return {
    ok: true,
    value: {
      ownerId,
      title: String(body.title || "Mlimani Film").trim().slice(0, 120),
      language: String(body.language || "sw").slice(0, 12),
      scenes: normalized
    }
  };
}
