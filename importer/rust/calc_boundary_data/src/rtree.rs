use rstar::{AABB, Envelope, PointDistance, RTreeObject};
use uuid::Uuid;
use geo::Point as GeoPoint;

pub(crate) type Coord = f64;


#[derive(Clone)]
pub(crate) struct RTreeIndexPoint {
    pub hf_guid: Uuid,
    pub geo_point: GeoPoint<f64>,
    pub envelope: AABB<[Coord; 2]>,
}

/// Implement this to support nearest neighbor calculations
impl PointDistance for RTreeIndexPoint {
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
impl RTreeObject for RTreeIndexPoint {
    type Envelope = AABB<[Coord; 2]>;

    fn envelope(&self) -> Self::Envelope {
        self.envelope
    }
}

impl PartialEq for RTreeIndexPoint {
    fn eq(&self, other: &Self) -> bool {
        self.hf_guid == other.hf_guid
    }
}

impl Eq for RTreeIndexPoint {}
