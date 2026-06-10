import { K } from '@angular/cdk/keycodes';
import { Observable, Subject } from 'rxjs';

export class ObservableSet<T> extends Set<T> {
	private readonly _changes = new Subject<Set<T>>();

	get changes(): Observable<Set<T>> {
		return this._changes.asObservable();
	}

	add(value: T): this {
		const isNew = !this.has(value);
		super.add(value);
		if (isNew) {
			this._changes.next(this);
		}
		return this;
	}

	delete(value: T): boolean {
		const result = super.delete(value);
		if (result) {
			this._changes.next(this);
		}
		return result;
	}

	clear(): void {
		super.clear();
		this._changes.next(this);
	}
}

export class ObservableMap<K, V> extends Map<K, V> {
	private readonly _changes = new Subject<Map<K, V>>();

	get changes(): Observable<Map<K, V>> {
		return this._changes.asObservable();
	}

	set(key: K, value: V): this {
		super.set(key, value);
		this._changes.next(this);
		return this;
	}

	delete(key: K): boolean {
		const result = super.delete(key);
		if (result) {
			this._changes.next(this);
		}
		return result;
	}

	clear(): void {
		super.clear();
		this._changes.next(this);
	}
}