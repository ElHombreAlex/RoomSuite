'use strict';

// Shared by the browser editors, the headless renderer and MCP validation.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./color-look.js'));
  else root.RoomGrade = factory(root.RoomColorLook);
})(typeof globalThis === 'object' ? globalThis : this, function (Look) {
  const specs = Object.freeze({
    brightness: [-100, 100], contrast: [-100, 100], saturation: [-100, 100],
    exposure_ev: [-2, 2], temperature: [-100, 100], tint: [-100, 100],
    highlights: [-100, 100], shadows: [-100, 100], whites: [-100, 100],
    blacks: [-100, 100], vibrance: [-100, 100]
  });
  const basic = ['brightness', 'contrast', 'saturation'];
  const advanced = Object.keys(specs).filter(key => !basic.includes(key));
  const maxBytes = 2 * 1024 * 1024;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const plain = value => value && typeof value === 'object' && !Array.isArray(value);
  const unknownKeys = (value, allowed, label) => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error('Unsupported ' + label + ': ' + key + '.');
  };
  function adjustments(input = {}) {
    if (!plain(input)) throw new Error('Adjustments must be an object.');
    unknownKeys(input, Object.keys(specs), 'adjustment');
    const result = {};
    for (const [key, [low, high]] of Object.entries(specs)) {
      const value = input[key] === undefined ? 0 : input[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) throw new Error('Invalid ' + key + ' adjustment.');
      result[key] = value;
    }
    return result;
  }
  function preset(input) {
    if (!plain(input)) throw new Error('The preset must be an object.');
    unknownKeys(input, ['format', 'schema_version', 'color_pipeline_version', 'name', 'description', 'tags', 'adjustments', 'effects', 'look'], 'preset field');
    if (input.format !== 'roomsuite.color-preset' || !((input.schema_version === 1 && input.color_pipeline_version === 1)||(input.schema_version === 2 && input.color_pipeline_version === 2))) throw new Error('This preset format or version is not supported.');
    if(input.schema_version===1&&input.look!==undefined)throw new Error('Version 1 presets cannot contain creative looks.');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new Error('Preset names must contain 1–100 characters.');
    if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 500)) throw new Error('Preset descriptions must be at most 500 characters.');
    if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.length > 12 || input.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 40))) throw new Error('A preset can have up to 12 short tags.');
    if (input.effects !== undefined && (!Array.isArray(input.effects) || input.effects.length)) throw new Error('Unsupported preset effects.');
    const result={ format:'roomsuite.color-preset', schema_version:input.schema_version, color_pipeline_version:input.color_pipeline_version, name:input.name.trim(),
      description:input.description || '', tags:(input.tags || []).map(tag => tag.trim()), adjustments:adjustments(input.adjustments), effects:[] };
    if(input.schema_version===2)result.look=Look.validate(input.look);return result;
  }
  function parse(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > maxBytes) throw new Error('Preset files must be 2 MiB or smaller.');
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('The preset is not valid JSON.'); }
    return preset(data);
  }
  function makePreset(name, values, description = '', tags = [], look = undefined) {
    const checked=Look.validate(look),version=Look.hasSettings(checked)?2:1;
    const result=preset({ format:'roomsuite.color-preset', schema_version:version, color_pipeline_version:version, name, description, tags, adjustments:values, effects:[], ...(version===2?{look:checked}:{}) });
    serializePreset(result);return result;
  }
  function serializePreset(item){const text=JSON.stringify(preset(item))+'\n';if(new TextEncoder().encode(text).length>maxBytes)throw new Error('This preset exceeds the 2 MiB limit.');return text;}
  const builtins = Object.freeze([
    makePreset('Warm daylight', { exposure_ev:.2, temperature:22, highlights:-12, shadows:12, vibrance:18 }, 'A gentle, warm lift.', ['warm','daylight']),
    makePreset('Cool evening', { exposure_ev:-.15, temperature:-22, tint:5, highlights:-18, shadows:8, saturation:-8 }, 'Cooler light with softer highlights.', ['cool','evening']),
    makePreset('Soft portrait', { exposure_ev:.1, temperature:8, contrast:-8, highlights:-20, shadows:18, vibrance:10 }, 'Gentle contrast and open shadows.', ['portrait','soft']),
    makePreset('Black and white', { saturation:-100, contrast:12, highlights:-8, shadows:8 }, 'A classic monochrome starting point.', ['monochrome'])
  ]);
  function readTarget(target, kind) {
    if (!plain(target)) throw new Error('A layer or clip is required.');
    const grade = target.colorGrade === undefined ? {} : target.colorGrade;
    if (!plain(grade)) throw new Error('Invalid stored color grade.');
    unknownKeys(grade, [...advanced, 'strength', 'enabled','look'], 'stored color field');
    const strength = grade.strength === undefined ? 100 : grade.strength;
    const enabled = grade.enabled === undefined ? true : grade.enabled;
    if (typeof strength !== 'number' || !Number.isFinite(strength) || strength < 0 || strength > 100 || typeof enabled !== 'boolean') throw new Error('Invalid stored color strength or enabled state.');
    const offset = kind === 'clip' ? 100 : 0;
    const values = Object.fromEntries(basic.map(key => [key, (target[key] === undefined ? offset : target[key]) - offset]));
    for (const key of advanced) if (grade[key] !== undefined) values[key] = grade[key];
    return { adjustments:adjustments(values), strength, enabled, look:Look.validate(grade.look) };
  }
  function writeTarget(target, kind, values, strength = 100, enabled = true, look = undefined) {
    const checked = adjustments(values);
    if (typeof strength !== 'number' || !Number.isFinite(strength) || strength < 0 || strength > 100 || typeof enabled !== 'boolean') throw new Error('Invalid color strength or enabled state.');
    const offset = kind === 'clip' ? 100 : 0;
    for (const key of basic) target[key] = checked[key] + offset;
    const checkedLook=Look.validate(look===undefined?target.colorGrade?.look:look);
    target.colorGrade = { ...Object.fromEntries(advanced.map(key => [key, checked[key]])), strength, enabled,...(Look.hasSettings(checkedLook)?{look:checkedLook}:{}) };
    return target;
  }
  function effective(grade, before = false) {
    const scale = !before && grade.enabled ? grade.strength / 100 : 0;
    const values=Object.fromEntries(Object.entries(grade.adjustments).map(([key, value]) => [key, value * scale]));
    if(scale&&Look.active(grade.look)){values.look=grade.look;values.lookMix=scale;}return values;
  }
  function cssFilter(values) {
    return `brightness(${100 + values.brightness}%) contrast(${100 + values.contrast}%) saturate(${100 + values.saturation}%)`;
  }
  function hasAdvanced(values) { return advanced.some(key => values[key] !== 0) || !!values.look; }
  // Operations use browser-decoded, display-referred RGB. Alpha is never modified.
  function applyPixels(data, values, width, height) {
    const exposure = Math.pow(2, values.exposure_ev), temp = values.temperature / 100, tint = values.tint / 100;
    const red = exposure * (1 + temp * .18 + tint * .04), green = exposure * (1 - tint * .10), blue = exposure * (1 - temp * .18 + tint * .04);
    const hi = values.highlights * .45, sh = values.shadows * .45, wh = values.whites * .35, bl = values.blacks * .35, vib = values.vibrance / 100;
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      let r = data[i] * red, g = data[i + 1] * green, b = data[i + 2] * blue;
      const l = clamp((.2126 * r + .7152 * g + .0722 * b) / 255, 0, 1);
      const low = 1 - l, l2 = l * l, low2 = low * low;
      const delta = hi * l2 + sh * low2 + wh * l2 * l2 + bl * low2 * low2;
      r += delta; g += delta; b += delta;
      const gray = .2126 * r + .7152 * g + .0722 * b;
      const chroma = clamp((Math.max(r, g, b) - Math.min(r, g, b)) / 255, 0, 1);
      const factor = 1 + vib * .75 * (1 - chroma);
      data[i] = clamp(gray + (r - gray) * factor, 0, 255);
      data[i + 1] = clamp(gray + (g - gray) * factor, 0, 255);
      data[i + 2] = clamp(gray + (b - gray) * factor, 0, 255);
    }
    if(values.look)Look.apply(data,width,height,values.look,values.lookMix);return data;
  }
  const cache = new WeakMap();
  const lookIds=new WeakMap();let nextLookId=1;
  let scratch;
  function renderSource(source, values, width, height, cacheable = false) {
    if (!hasAdvanced(values)) return source;
    width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height));
    if(values.look&&!lookIds.has(values.look))lookIds.set(values.look,nextLookId++);
    const key = cacheable?JSON.stringify([width, height, ...advanced.map(name => values[name]),values.look?lookIds.get(values.look):0,values.lookMix||0]):'';
    const previous = cacheable && cache.get(source);
    if (previous && previous.key === key) return previous.canvas;
    const canvas = cacheable ? document.createElement('canvas') : (scratch ||= document.createElement('canvas'));
    if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently:true });
    if (!context) throw new Error('This browser cannot process the color grade.');
    context.clearRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    applyPixels(image.data, values,width,height); context.putImageData(image, 0, 0);
    if (cacheable) cache.set(source, { key, canvas });
    return canvas;
  }
  return { specs, basic, advanced, maxBytes, adjustments, preset, parse, makePreset, serializePreset, builtins, readTarget, writeTarget, effective, cssFilter, hasAdvanced, applyPixels, renderSource, Look };
});
