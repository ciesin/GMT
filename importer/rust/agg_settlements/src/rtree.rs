use rstar::{AABB, Envelope, PointDistance, RTreeObject};

pub(crate) type Coord = f64;


#[derive(Clone)]
pub(crate) struct RTreeIndex {
    pub list_index: usize,
    pub envelope: AABB<[Coord; 2]>,
}

//we want like manhattan distance
fn dist_helper(lb: f64, ub: f64, to_check: f64) -> f64 {
    assert!(lb < ub);
    if lb > to_check {
        return lb - to_check;
    }
    if to_check > ub {
        return to_check - ub;
    }

    return 0.;
}



/// Implement this to support nearest neighbor calculations
impl PointDistance for RTreeIndex {
    /// For speed, use the distance of the center of the envelope to the point
    fn distance_2(
        &self,
        rhs: &[Coord; 2]) -> Coord {
        //let center = self.envelope.center();

        let lb = self.envelope.lower();
        let up = self.envelope.upper();
        let x_dist = dist_helper(lb[0], up[0], rhs[0]);
        let y_dist = dist_helper(lb[1], up[1], rhs[1]);

        //manhattan distance
        return if x_dist > y_dist {
            x_dist
        } else {
            y_dist
        }

        //return center.distance_2(rhs);
    }

    // This implementation is not required but more efficient since it
    // omits the calculation of a square root
    fn contains_point(&self, point: &[Coord; 2]) -> bool
    {
        self.envelope.contains_point(point)
    }
}

/// Rstar requires this implementation to know how to index it
impl RTreeObject for RTreeIndex {
    type Envelope = AABB<[Coord; 2]>;

    fn envelope(&self) -> Self::Envelope {
        self.envelope
    }
}

impl PartialEq for RTreeIndex {
    fn eq(&self, other: &Self) -> bool {
        self.list_index == other.list_index
    }
}

impl Eq for RTreeIndex {}





