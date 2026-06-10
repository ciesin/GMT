use rstar::{AABB, PointDistance, Envelope, RTreeObject};

pub type Coord  = f64;

#[derive(Eq, PartialEq, Hash, Clone, Copy)]
pub struct FeatureKey {
    pub fid: i64,
    pub layer_idx: u8
}

//#[derive(Deserialize, Serialize, Clone)]
#[derive(Clone)]
pub struct RTreeIndexObject {
    pub feature_key: FeatureKey,
    pub envelope: AABB<[Coord; 2]>,
}

/// Implement this to support nearest neighbor calculations
impl PointDistance for RTreeIndexObject {
    /// For speed, use the distance of the center of the envelope to the point
    fn distance_2(
        &self,
        rhs: &[Coord; 2]) -> Coord {
        let center = self.envelope.center();

        // Vector distance in lat/lon
        return center.distance_2(rhs);
    }

    // This implementation is not required but more efficient since it
    // omits the calculation of a square root
    fn contains_point(&self, point: &[Coord; 2]) -> bool
    {
        self.envelope.contains_point(point)
    }
}

/// Rstar requires this implementation to know how to index it
impl RTreeObject for RTreeIndexObject {
    type Envelope = AABB<[Coord; 2]>;

    fn envelope(&self) -> Self::Envelope {
        self.envelope
    }
}

impl PartialEq for RTreeIndexObject {
  fn eq(&self, other: &Self) -> bool {
      self.feature_key == other.feature_key
  }
}
impl Eq for RTreeIndexObject {}