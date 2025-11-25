import logging
import os
from pathlib import Path
from typing import List, Union

import toml

ROOT_PATH: Path = Path(__file__ + '/../..').resolve()


class BaseConfig:
    """
    配置管理的基类。
    """
    toml_file_path = os.path.join(ROOT_PATH, 'config.toml')
    section = None

    @classmethod
    def update_from_toml(cls, section: str = None):
        try:
            cls.section = section
            config = toml.load(cls.toml_file_path)
            items = config.get(section, {}) if section else config
            for key, value in items.items():
                if hasattr(cls, key.upper()):
                    setattr(cls, key.upper(), value)
        except Exception as err:
            logging.error(f'Error occurred while loading config file: {err}')

    @classmethod
    def save_to_toml(cls):
        try:
            config = toml.load(cls.toml_file_path)
            if cls.section:
                if cls.section not in config:
                    config[cls.section] = {}
                for key in dir(cls):
                    if key.isupper():
                        config[cls.section][key] = getattr(cls, key)
            else:
                for key in dir(cls):
                    if key.isupper():
                        config[key] = getattr(cls, key)
            with open(cls.toml_file_path, 'w') as f:
                toml.dump(config, f)
        except Exception as err:
            logging.error(f'Error occurred while saving config file: {err}')

class Config(BaseConfig):
    """
    全局配置管理类。
    """
    LOGGING: bool = True # 是否开启日志 Boolean
    LOG_LEVEL: int = 20 # 日志等级，数字越大，日志越详细 Integer
    SQLALCHEMY_LOG: bool = False  # 是否开启SQLAlchemy日志
    PROXY: str = None  # 代理
    MAX_RETRY: int = 3  # 重试次数
    DATABASES_DIR: Path = ROOT_PATH / 'db'  # 数据库路径
    BANGUMI_TOKEN: str = ''  # Bangumi Token
    
class ManageConfig(BaseConfig):
    """
    管理配置管理类。
    """
    ADMIN_LIST: Union[str , int , List[Union[str, int]]] = '' # 管理员UID名单, 为str/int或者其List 
    IDENTIFY_CODE: Union[str, int] = 1 # 身份码 , 用于识别 普通用户/白名单/管理员 , 默认为1(普通用户) , 0为管理员 , 2为白名单
    ACTIVE_STATUS: bool = True # 账号是否在Emby启用/禁用
    VALIDITY_TIME: int

class EmbyConfig(BaseConfig):
    """
    Emby配置管理类。
    """

Config.update_from_toml()
EmbyConfig.update_from_toml('Emby')