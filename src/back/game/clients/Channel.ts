/*
 * Rule the words! KKuTu Online
 * Copyright (C) 2020  JJoriping(op@jjo.kr)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import Cluster = require("cluster");
import { Logger } from "back/utils/Logger";
import { SETTINGS } from "back/utils/System";
import { reservations } from "../RoomServer";
import { clients, rooms } from "../LobbyServer";
import { Room } from "../Room";
import { Client } from "./Client";

/**
 * 게임 방 서버와의 IPC 통신을 위한 클래스.
 *
 * 로비 서버는 인스턴스 메소드를, 게임 방 서버는 정적 메소드를 사용해 IPC 통신한다.
 */
export class Channel{
  private static readonly requestHandlerTable:KKuTu.Packet.RequestHandlerTable = {
    'room-reserve': data => {
      if(reservations[data.master]){
        Logger.warning("room-reserve").put(`Already reserved: ${data.master}`).out();

        return;
      }
      reservations[data.master] = {
        room : data.room,
        timer: global.setTimeout(() => {
          Channel.responseToMaster('room-expired', {
            master: data.master,
            id    : data.room.id
          });
          delete reservations[data.master];
        }, SETTINGS.application['room-reservation-timeout'])
      };
    }
  };

  /**
   * 로비 서버로부터 온 요청을 처리한다.
   */
  public static handleRequest(message:any):void{
    const { type, ...data } = message;
    const handler = (Channel.requestHandlerTable as any)[type];
    const logger = Logger.log("Channel").put(type);

    for(const k in data as Table<any>){
      logger.next(k);
      if(typeof data[k] === "object"){
        logger.put(JSON.stringify(data[k]));
      }else{
        logger.put(data[k]);
      }
    }
    logger.out();
    if(!handler){
      Logger.error("Channel").put(`Unhandled type: ${type}`).out();

      return;
    }
    handler(data);
  }
  /**
   * 로비 서버로 정보를 보낸다.
   *
   * @param type 응답 유형.
   * @param data 추가 정보 객체.
   */
  public static responseToMaster<T extends KKuTu.Packet.ResponseType>(
    type:T,
    data:KKuTu.Packet.ResponseData<T> = {} as any
  ):void{
    process.send({ type, ...data });
  }

  private readonly responseHandlerTable:KKuTu.Packet.ResponseHandlerTable = {
    'room-expired': data => {
      if(!rooms[data.id]){
        Logger.warning("room-expired").put(`No such room: ${data.id}`).out();

        return;
      }
      for(const v of rooms[data.id].players){
        if(!clients[v]){
          continue;
        }
        clients[v].response('room-stuck');
      }
      delete rooms[data.id];
    },
    'room-publish': data => {
      const room = rooms[data.room.id];

      if(!room){
        return;
      }
      Object.assign(room, data.room);
      Client.publish('room', data);
    },
    'room-reserve': ({ master, room }) => {
      if(rooms[room.id] || !clients[master]){
        this.requestToWorker('room-invalid', { room });

        return;
      }
      rooms[room.id] = new Room(room.id, this.worker.id, room);
    }
  };
  private worker:Cluster.Worker;

  /**
   * 게임 방 서버와 IPC 통신할 준비를 한다.
   *
   * @param worker 게임 방 서버 프로세스 객체.
   */
  constructor(worker:Cluster.Worker){
    this.worker = worker;
    worker.on('message', message => {
      const { type, ...data } = message;
      const handler = (this.responseHandlerTable as any)[type];

      if(!handler){
        Logger.error("Channel").put(`Unhandled type: ${type}`).out();

        return;
      }
      handler(data);
    });
  }

  /**
   * 게임 방 서버 프로세스의 종료 여부를 반환한다.
   */
  public isDead():boolean{
    return this.worker.isDead();
  }
  /**
   * 게임 방 서버로 정보를 보낸다.
   *
   * @param type 요청 유헝.
   * @param data 추가 정보 객체.
   */
  public requestToWorker<T extends KKuTu.Packet.RequestType>(type:T, data:KKuTu.Packet.RequestData<T> = {} as any):void{
    this.worker.send({ type, ...data });
  }
}
