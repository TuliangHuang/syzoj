import * as TypeORM from "typeorm";
import Model from "./common";
import QuestionTag from "./question_tag";
import QuestionTagMap from "./question_tag_map";
import LRU = require("lru-cache");
const { tagColorOrder } = require('../constants');

declare var syzoj: any;

@TypeORM.Entity()
export default class Question extends Model {
  static cache = true;

  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  @TypeORM.Column({ nullable: true, type: "integer" })
  parent_id: number;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 80 })
  title: string;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 40 })
  type: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  source: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  description: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  answer: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  tutorial: string;

  async getTags() {
    let tagIDs;
    const questionTagCache: LRU<number, number[]> = (Question as any)._tagCache || ((Question as any)._tagCache = new LRU<number, number[]>({ max: syzoj.config.db.cache_size }));

    if (questionTagCache.has(this.id)) {
      tagIDs = questionTagCache.get(this.id);
    } else {
      let maps = await QuestionTagMap.find({
        where: { question_id: this.id }
      });

      tagIDs = maps.map(x => x.tag_id);
      questionTagCache.set(this.id, tagIDs);
    }

    let res = await (tagIDs as any).mapAsync(async tagID => {
      return QuestionTag.findById(tagID);
    });

    const sortOrder = tagColorOrder;
    const orderMap = {} as { [color: string]: number };
    sortOrder.forEach((color, idx) => {
      if (!(color in orderMap)) orderMap[color] = idx;
    });
    res.sort((a, b) => {
      if (a.color === b.color) return a.name.localeCompare(b.name, 'zh');
      const ia = orderMap[a.color];
      const ib = orderMap[b.color];
      if (ia !== undefined && ib !== undefined) return ia - ib;
      return (a.color as any) < (b.color as any);
    });
    return res;
  }

  async setTags(newTagIDs: number[]) {
    let oldTagIDs = (await this.getTags()).map(x => x.id);

    let delTagIDs = oldTagIDs.filter(x => !newTagIDs.includes(x));
    let addTagIDs = newTagIDs.filter(x => !oldTagIDs.includes(x));

    for (let tagID of delTagIDs) {
      let map = await QuestionTagMap.findOne({
        where: {
          question_id: this.id,
          tag_id: tagID
        }
      });
      if (map) await map.destroy();
    }

    for (let tagID of addTagIDs) {
      let map = await QuestionTagMap.create({
        question_id: this.id,
        tag_id: tagID
      });
      await map.save();
    }

    const questionTagCache: LRU<number, number[]> = (Question as any)._tagCache || ((Question as any)._tagCache = new LRU<number, number[]>({ max: syzoj.config.db.cache_size }));
    questionTagCache.set(this.id, newTagIDs);
  }

  async changeID(id) {
    const entityManager = TypeORM.getManager();

    id = parseInt(id);

    // Update primary key and all referencing tables
    await entityManager.query('UPDATE `question`         SET `id`          = ' + id + ' WHERE `id`          = ' + this.id);
    await entityManager.query('UPDATE `question_tag_map` SET `question_id` = ' + id + ' WHERE `question_id` = ' + this.id);

    const oldID = this.id;
    this.id = id;

    await this.save();

    await Question.deleteFromCache(oldID);
  }
}
