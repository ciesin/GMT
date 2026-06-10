use std::env;

use itertools::Itertools;
use log::warn;

use crate::hf::HfType;

fn read_env_f64(env_key: &str, default: f64) -> f64 {
    let env_str = env::var(env_key);

    if let Ok(env_val) = env_str {
        match env_val.parse::<f64>() {
            Ok(n) => n,
            Err(_e) => {
                warn!("Cannot parse env key [{}] value [{}]", env_key, env_val);
                default
            }
        }
    } else {
        warn!("Cannot find env key [{}] defaulting to [{}]", env_key, default);
        default
    }
}


pub(crate) struct WeightConfigHfType {
    fixed_post: f64,
    outreach: f64,
}

impl WeightConfigHfType {
    pub fn new() -> Self {
        Self {
            fixed_post: read_env_f64("COVERAGE_WEIGHT_STRATEGY_FIXED_POST", 1.0),
            outreach: read_env_f64("COVERAGE_WEIGHT_STRATEGY_OUTREACH", 1.0),
        }
    }

    pub fn get_weight(&self, s: &HfType) -> f64 {
        match s {
            HfType::FixedPost => self.fixed_post,
            HfType::Outreach => self.outreach,
            _ => panic!("Unexpected strategy")
        }
    }
}


pub(crate) struct WeightConfigFrequency {
    unknown: f64,
    once_per_month: f64,
    twice_per_month: f64,
    three_per_month: f64,
    once_per_week: f64,
    twice_per_week: f64,
    three_per_week: f64,
    four_per_week: f64,
    five_per_week: f64,
    six_per_week: f64,
    daily: f64,
    other: f64,
}

impl WeightConfigFrequency {
    pub fn new() -> Self {
        Self {
            unknown: read_env_f64("COVERAGE_WEIGHT_FREQUENCY_UNKNOWN", 1.0),
            once_per_month: read_env_f64("COVERAGE_WEIGHT_FREQUENCY_ONCE_PER_MONTH", 1.0),
            twice_per_month: read_env_f64("COVERAGE_WEIGHT_FREQUENCY_TWICE_PER_MONTH", 1.0),
            three_per_month: read_env_f64("COVERAGE_WEIGHT_FREQUENCY_THREE_PER_MONTH", 1.0),
            once_per_week: read_env_f64("COVERAGE_WEIGHT_FREQUENCY_ONCE_PER_WEEK", 1.0),
            twice_per_week: read_env_f64("COVERAGE_WEIGHT_FREQUENCY_TWICE_PER_WEEK", 1.0),
            three_per_week: read_env_f64("COVERAGE_WEIGHT_FREQUENCY_THREE_PER_WEEK", 1.0),
            four_per_week: read_env_f64("COVERAGE_WEIGHT_FREQUENCY_FOUR_PER_WEEK", 1.0),
            five_per_week: read_env_f64("COVERAGE_WEIGHT_FREQUENCY_FIVE_PER_WEEK", 1.0),
            six_per_week: read_env_f64("COVERAGE_WEIGHT_FREQUENCY_SIX_PER_WEEK", 1.0),
            daily: read_env_f64("COVERAGE_WEIGHT_FREQUENCY_DAILY", 1.0),
            other: read_env_f64("COVERAGE_WEIGHT_FREQUENCY_OTHER", 1.0),
        }
    }

    pub fn get_weight(&self, freq: &str) -> f64 {
        match freq {
            "unknown" => self.unknown,
            "oncePerMonth" => self.once_per_month,
            "twicePerMonth" => self.twice_per_month,
            "threePerMonth" => self.three_per_month,
            "oncePerWeek" => self.once_per_week,
            "twicePerWeek" => self.twice_per_week,
            "threePerWeek" => self.three_per_week,
            "fourPerWeek" => self.four_per_week,
            "fivePerWeek" => self.five_per_week,
            "sixPerWeek" => self.six_per_week,
            "daily" => self.daily,
            "other" => self.other,
            _ => self.unknown,
        }
    }
}

pub(crate) struct WeightConfigBoundary {
    pub(crate) inside: f64,
    pub(crate) outside: f64,
}

impl WeightConfigBoundary {
    pub fn new() -> Self {
        Self {
            inside: read_env_f64("COVERAGE_WEIGHT_BOUNDARY_INSIDE", 1.0),
            outside: read_env_f64("COVERAGE_WEIGHT_BOUNDARY_OUTSIDE", 1.0),

        }
    }
}

pub(crate) struct DistanceWeightPair {
    pub(crate) distance: f64,
    pub(crate) weight: f64,
}

pub(crate) struct WeightConfigDistance {
    pairs: Vec<DistanceWeightPair>,

    max_distance: f64,
}

const ENV_KEY_COVERAGE_WEIGHT_DISTANCE_BREAKPOINTS: &str = "COVERAGE_WEIGHT_DISTANCE_BREAKPOINTS";

impl WeightConfigDistance {
    pub fn new() -> Self {
        let env_str = match env::var(ENV_KEY_COVERAGE_WEIGHT_DISTANCE_BREAKPOINTS) {
            Ok(n) => n,
            Err(_e) => {
                warn!("Cannot parse find env key [{}] defaulting...", ENV_KEY_COVERAGE_WEIGHT_DISTANCE_BREAKPOINTS);
                "0,100;2000,10;3000,0".to_string()
            }
        };

        let mut pairs = env_str.split(";").map(|dist_weight_str| {
            let split = dist_weight_str.split_once(",");

            if split.is_none() {
                panic!("Cannot parse {}, check comma seperates distance and weight values", env_str);
            }

            let split = split.unwrap();

            let distance: f64 = split.0.parse().expect(&format!("Cannot parse distance in {}", ENV_KEY_COVERAGE_WEIGHT_DISTANCE_BREAKPOINTS));
            let weight: f64 = split.1.parse().expect("Cannot parse weight in COVERAGE_WEIGHT_DISTANCE_BREAKPOINTS");

            DistanceWeightPair { distance, weight }
        }).collect_vec();

        pairs.sort_by(|a, b| a.distance.partial_cmp(&b.distance).unwrap());

        let max_distance = pairs.last().unwrap().distance;

        Self {
            pairs,
            max_distance
        }
    }

    pub(crate) fn get_weight(&self, distance: f64) -> f64 {
        for w in self.pairs.windows(2) {
            let dw1 = &w[0];
            let dw2 = &w[1];

            if distance >= dw1.distance && distance <= dw2.distance {
                //normal case linear interp between these 2 points

                //y = y1 + ((x – x1) / (x2 – x1)) * (y2 – y1)
                //y is weight
                let slope = (distance - dw1.distance) / (dw2.distance - dw1.distance);
                return dw1.weight + slope * (dw2.weight - dw1.weight);
            }
        }

        //If our distance is less than the 1st point, we return the 1st
        if distance < self.pairs[0].distance {
            return self.pairs[0].weight;
        }

        //Here our distance is greater than all breakpoints, so weight is 0.0
        return 0.0;
    }

    pub(crate) fn get_max_distance_2(&self) -> f64 {
        //a little larger just in case
        return self.max_distance * self.max_distance * 1.2;
    }
}

pub(crate) struct WeightConfig {
    pub(crate) boundary: WeightConfigBoundary,
    pub(crate) frequency: WeightConfigFrequency,
    pub(crate) hf_type: WeightConfigHfType,
    pub(crate) distance: WeightConfigDistance,

    pub(crate) min_square_perc: f64,
    pub(crate) min_settlement_perc: f64,
    pub(crate) min_settlement_pop: f64,
}

impl WeightConfig {
    pub fn new() -> Self {

        let min_square_perc = env::var("COVERAGE_WEIGHT_MIN_PERCENTAGE").unwrap_or("0.01".to_string()).parse().unwrap();
        let min_settlement_perc= env::var("COVERAGE_WEIGHT_MIN_SETT_PERCENTAGE").unwrap_or("0.05".to_string()).parse().unwrap();
        
        let min_settlement_pop = env::var("COVERAGE_WEIGHT_MIN_SETT_POP").unwrap_or("500".to_string()).parse().unwrap();
        Self {
            boundary: WeightConfigBoundary::new(),
            frequency: WeightConfigFrequency::new(),
            hf_type: WeightConfigHfType::new(),
            distance: WeightConfigDistance::new(),
            min_square_perc,
            min_settlement_perc,
            min_settlement_pop
        }
    }
}


#[cfg(test)]
mod test {
    use float_cmp::{ApproxEq, F64Margin};
    use num::Float;

    use super::*;

    #[test]
    fn test_distance_weight() {
        env::set_var(ENV_KEY_COVERAGE_WEIGHT_DISTANCE_BREAKPOINTS, "0,100;500,90;1000,50;2000,10");

        let wc = WeightConfig::new();

        let margin = F64Margin { epsilon: 10. * f64::epsilon(), ulps: 3 };

        assert!(wc.distance.get_weight(-1.0).approx_eq(100.0, margin));
        assert!(wc.distance.get_weight(0.).approx_eq(100.0, margin));
        assert!(wc.distance.get_weight(250.).approx_eq(95.0, margin));
        assert!(wc.distance.get_weight(500.).approx_eq(90.0, margin));
        assert!(wc.distance.get_weight(750.).approx_eq(70.0, margin));
        assert!(wc.distance.get_weight(1000.).approx_eq(50.0, margin));
        //println!("dist {}", wc.distance.get_weight(1990.));
        assert!(wc.distance.get_weight(1990.).approx_eq(10.4, margin));
        assert!(wc.distance.get_weight(2000.0).approx_eq(10.0, margin));
        assert!(wc.distance.get_weight(2000.1).approx_eq(0.0, margin));
        assert!(wc.distance.get_weight(3000.).approx_eq(0.0, margin));
        assert!(wc.distance.get_weight(10000.).approx_eq(0.0, margin));
    }
}