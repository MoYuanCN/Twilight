"""
API 模块

提供 Flask Web API
"""
from flask import Flask, jsonify, request

from src.api.routes import api, admin_api
from src.api.v1 import register_v1_blueprints
from src.config import Config, APIConfig
from src.core.utils import setup_logging, timestamp


from flask_cors import CORS

def create_app() -> Flask:
    """创建 Flask 应用"""
    import os
    from pathlib import Path
    from src.config import APIConfig
    
    # 获取上传目录配置
    uploads_path = APIConfig.UPLOAD_FOLDER
    
    # 确保上传目录存在
    os.makedirs(uploads_path, exist_ok=True)
    
    app = Flask(__name__, static_folder=uploads_path, static_url_path='/uploads')
    
    # 配置
    app.config['JSON_AS_ASCII'] = False  # 支持中文
    app.config['JSON_SORT_KEYS'] = False
    app.config['MAX_CONTENT_LENGTH'] = APIConfig.MAX_UPLOAD_SIZE  # 最大上传文件大小
    app.config['UPLOAD_FOLDER'] = uploads_path
    # uploads_path 目录作为静态文件目录挂载，用于存储上传的文件并通过 /uploads 提供访问
    
    # CORS 跨域支持
    if APIConfig.CORS_ENABLED:
        cors_origins = APIConfig.CORS_ORIGINS or ["*"]
        allow_all = False
        if cors_origins == "*":
            allow_all = True
        elif isinstance(cors_origins, (list, tuple, set)) and "*" in cors_origins:
            allow_all = True

        CORS(
            app,
            resources={r"/api/*": {"origins": cors_origins}},
            supports_credentials=not allow_all,
            allow_headers=['Content-Type', 'Authorization', 'X-API-Key'],
            methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
            max_age=3600,
        )
    
    # 注册旧版 API（兼容）
    app.register_blueprint(api)
    app.register_blueprint(admin_api)
    
    # 注册 v1 API（推荐前端使用）
    # 这里将 /api/v1 下的蓝图全部挂载到主应用，以保持版本化路由结构。
    register_v1_blueprints(app)
    
    # 配置日志
    if Config.LOGGING:
        setup_logging(level=Config.LOG_LEVEL)
    
    # 根路由
    @app.route('/')
    def index():
        return jsonify({
            'name': 'Twilight API',
            'version': '1.0.0',
            'api_versions': ['v1'],
            'docs': '/api/v1/docs',
        })
    
    # API 文档路由
    @app.route('/api/v1/openapi.json')
    def openapi_json():
        from src.api.v1.openapi import generate_openapi_spec
        return jsonify(generate_openapi_spec())

    @app.route('/api/v1/docs')
    def api_docs():
        from src.api.swagger_template import SWAGGER_UI_HTML
        return SWAGGER_UI_HTML

    @app.after_request
    def apply_security_headers(response):
        # 基础安全响应头
        response.headers.setdefault('X-Content-Type-Options', 'nosniff')
        response.headers.setdefault('X-Frame-Options', 'DENY')
        response.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')

        # 认证相关接口禁止缓存，避免令牌与敏感响应被浏览器缓存
        if request.path.startswith('/api/v1/auth'):
            response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        return response
    
    # 错误处理
    @app.errorhandler(404)
    def not_found(e):
        return jsonify({
            'success': False,
            'code': 404,
            'message': '接口不存在',
            'data': None,
            'timestamp': timestamp(),
        }), 404
    
    @app.errorhandler(500)
    def internal_error(e):
        # 统一 error handler，保证所有未捕获异常也按照统一 JSON 结构返回
        return jsonify({
            'success': False,
            'code': 500,
            'message': '服务器内部错误',
            'data': None,
            'timestamp': timestamp(),
        }), 500
    
    @app.errorhandler(405)
    def method_not_allowed(e):
        return jsonify({
            'success': False,
            'code': 405,
            'message': '请求方法不允许',
            'data': None,
            'timestamp': timestamp(),
        }), 405
    
    return app


__all__ = ['create_app', 'api', 'admin_api']
