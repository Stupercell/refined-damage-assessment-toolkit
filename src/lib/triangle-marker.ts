import L from "leaflet";

/**
 * Canvas-rendered upside-down triangle marker.
 * Subclasses CircleMarker so it works with L.canvas() renderer (fast for thousands).
 */
export const TriangleMarker = (L.CircleMarker as any).extend({
  options: {
    radius: 5,
    weight: 0.8,
    color: "rgba(0,0,0,0.85)",
    fillOpacity: 0.95,
  },
  _updatePath(this: any) {
    const renderer = this._renderer;
    if (!renderer || !renderer._ctx) return;
    const ctx: CanvasRenderingContext2D = renderer._ctx;
    const p = this._point;
    const r = this._radius || 5;
    if (!p) return;
    // Apex points DOWN (upside-down triangle in tornado-survey symbology)
    const top = p.y - r * 0.85;
    const bot = p.y + r * 1.0;
    ctx.beginPath();
    ctx.moveTo(p.x - r, top);
    ctx.lineTo(p.x + r, top);
    ctx.lineTo(p.x, bot);
    ctx.closePath();
    if (this.options.fill) {
      ctx.globalAlpha = this.options.fillOpacity ?? 1;
      ctx.fillStyle = this.options.fillColor || this.options.color;
      ctx.fill();
    }
    if (this.options.stroke && this.options.weight !== 0) {
      ctx.globalAlpha = this.options.opacity ?? 1;
      ctx.lineWidth = this.options.weight;
      ctx.strokeStyle = this.options.color;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
});

export function triangleMarker(latlng: L.LatLngExpression, options: L.CircleMarkerOptions) {
  return new (TriangleMarker as any)(latlng, options) as L.CircleMarker;
}
