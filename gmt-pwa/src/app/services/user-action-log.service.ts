import { Injectable } from '@angular/core';
import _ from 'lodash';
import { AppConfigService } from '../utils/app-config.service';
import { UserContextService } from './user-context.service';
import { AuthService } from './user/auth.service';
import { VectorLayerService } from './vector_layer/vector-layers.service';
import { ACTION_LIST } from './vector_layer/VectorLayerDatabase';
/*
Designed to track meaningful actions that a user performed

On sync sent to the server so we have a trace of what they did in order
to reproduce issues they had or understand how a data inconsistency arose

To see logs



SELECT 
	id, 
	user_name, 
	message, 
	l.payload, 
	elem.value 	
	--jsonb_typeof(l.payload), 
--	jsonb_array_elements(l.payload) WITH ORDINALITY AS elem(value, ordinality)
FROM master.logs l
JOIN LATERAL (
    SELECT value, ordinality
    FROM jsonb_array_elements(l.payload) WITH ORDINALITY
) AS elem(value, ordinality) ON TRUE 
WHERE jsonb_typeof(l.payload) = 'array'
ORDER BY id DESC, elem.ORDINALITY desc;
*/
@Injectable({
  providedIn: 'root',
})
export class UserActionLogService {
  constructor(
    private vectorLayerService: VectorLayerService,
    private authService: AuthService,
    private userContextService: UserContextService
  ) {}

  public async addUserActionDescription(
    actionDescription: string
  ): Promise<void> {
    const actionList = await this.getUserActionDescriptionList();

    const hash = await AppConfigService.fetchGitHash();

    const actionSuffix = `Username: [${this.authService.getUserName()}] Date: [${new Date().toISOString()}] App version: [${hash}]`;

    actionList.push(`${actionDescription} ${actionSuffix}`);

    await this.setUserActionDescriptions(actionList);

    //so we don't have to sync to see the data in the db
    if (AppConfigService.ENABLE_ACTION_LOG_DEBUG) {
      await this.submitToServer();
    }
  }
  public async getUserActionDescriptionList(): Promise<Array<string>> {
    let actionList = (await this.vectorLayerService._db.key_value.get(
      ACTION_LIST
    )) as Array<string>;
    if (!_.isArray(actionList)) {
      actionList = [];
    }
    return actionList;
  }
  public async setUserActionDescriptions(
    actionList: Array<string>
  ): Promise<void> {
    await this.vectorLayerService._db.key_value.put(actionList, ACTION_LIST);
  }

  public async submitToServer() {
    const actionList = await this.getUserActionDescriptionList();
    await this.userContextService.addServerLogMessage(
      'User action log',
      actionList
    );
  }
}
