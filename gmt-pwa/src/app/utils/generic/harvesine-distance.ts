function squared (x) { return x * x };

export function haversineDistance (x, y) {
  const xLat = x.latitude * Math.PI / 180.0;
  const yLat = y.latitude * Math.PI / 180.0;
  const xLng = x.longitude * Math.PI / 180.0;
  const yLng = y.longitude * Math.PI / 180.0;

  const ht = squared(Math.sin((yLat - xLat) / 2)) +  Math.cos(xLat) *  Math.cos(yLat) * squared(Math.sin((yLng - xLng) / 2));
  // 6378137 = equatorial mean radius of Earth (in meters)
  return 2 * 6378137 * Math.asin(Math.sqrt(ht));
}

