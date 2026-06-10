import {Injectable} from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class HistoryService {

  private stackUrls: string[] = [];

  constructor() {
  }

  stack(url: string) {
    //avoid duplicated url
    if (this.stackUrls[this.stackUrls.length -1] === url){
      return;
    }
    //stack could contains only one time am url
    if (this.stackUrls.includes(url)){
      this.stackUrls.splice(this.stackUrls.indexOf(url), 1);
    }

    this.stackUrls.push(url);
    //we want to stack only 2 urls
    if (this.stackUrls.length > 3) {//include the current url
      this.stackUrls.shift();
    }
  }

  clearStack() {
    this.stackUrls = [];
  }
  hasUrlStacked() {
    return this.stackUrls.length >= 2; //take into account current url
  }

  pop() {
    this.stackUrls.pop(); //delete current url
    return this.stackUrls.pop();
  }
}
