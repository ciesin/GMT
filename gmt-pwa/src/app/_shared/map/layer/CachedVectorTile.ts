import { Extent } from 'ol/extent';
import Projection from 'ol/proj/Projection';
import Feature from 'ol/Feature';
import Geometry from 'ol/geom/Geometry';
import { VectorTile } from 'ol';
import VectorTileSource, { Options } from 'ol/source/VectorTile';
import { UrlRequestCacheService } from '../../../services/url-request-cache.service';

export class CachedVectorTile extends VectorTileSource {
  tiles_loaded: number = 0;
  tiles_size: number = 0;

  constructor(
    options: Options,
    urlRequestCacheService: UrlRequestCacheService
  ) {
    super({
      tileLoadFunction: (tile, url) => {
        const vector_tile: VectorTile<Feature> =
          tile as unknown as VectorTile<Feature>;
        const loadTileFromData = (
          data: any,
          extent: Extent,
          resolution: number,
          projection: Projection
        ) => {
          //To monitor performance
          this.tiles_loaded += 1;
          this.tiles_size += data.byteLength;

          const format = vector_tile.getFormat();
          const features = format.readFeatures(data, {
            extent: extent,
            featureProjection: projection,
          });
          vector_tile.setFeatures(features as Feature<Geometry>[]);
        };
        vector_tile.setLoader(async (extent, resolution, projection) => {
          let tile;
          try {
            tile = await urlRequestCacheService.getOrFetch(url);
            if (tile) {
              loadTileFromData(tile, extent, resolution, projection);
              return;
            }
          } catch (error) {
            console.log(
              'Fetching tile from SERVER, url :',
              url,
              ', error: ',
              error
            );
          }
        });
      },
      ...options,
    });
  }
}
