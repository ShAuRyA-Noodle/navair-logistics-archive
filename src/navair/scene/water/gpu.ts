/**
 * GPU class, decided once by OceanGL when it creates its context (boot builds the
 * ocean before the timeline). Integrated / mobile GPUs start the water at a cheap
 * quality tier, and the choreography keeps the hull still there: sea motion would
 * force the world canvas to repaint every frame even with the scroll idle.
 */
export const waterGPU = { weak: false, renderer: '' };

export function classifyGPU(gl: WebGL2RenderingContext) {
  let name = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  } catch {
    /* privacy-restricted: fall back to the frame-time governor alone */
  }
  const discrete = /NVIDIA|GeForce|RTX|Quadro|Radeon (RX|Pro)|Arc\(TM\) A|Apple M\d (Pro|Max|Ultra)/i.test(name);
  const integrated = /Intel|UHD|Iris|Mali|Adreno|PowerVR|Apple GPU|SwiftShader|llvmpipe|Basic Render|Vega \d|Radeon\(TM\) Graphics/i.test(name);
  const small = window.matchMedia('(max-width: 860px)').matches || window.matchMedia('(pointer: coarse)').matches;
  waterGPU.renderer = name;
  waterGPU.weak = !discrete && (integrated || small);
  return waterGPU;
}
