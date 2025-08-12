import os
import sqlite3
import json
import traceback
from flask import Flask, request, jsonify, render_template
import google.generativeai as genai
from PIL import Image
from io import BytesIO
from tavily import TavilyClient
import re
import webbrowser # 導入 webbrowser 模組
import threading  # 導入 threading 模組

# --- App 設定 ---
# 確保 template_folder 和 static_folder 設定正確
app = Flask(__name__, template_folder='templates', static_folder='static')
app.config['SECRET_KEY'] = 'your-ultimate-secret-key-for-gemini' # 用於 session 加密的密鑰

# --- API 金鑰設定 ---
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY")

if not GOOGLE_API_KEY:
    print("❌ 錯誤：請先設定 GOOGLE_API_KEY 環境變數。應用程式將無法啟動。")
    # 可以選擇在這裡退出或提供其他處理方式
    # exit(1) # 如果希望沒有金鑰就立即退出
if not TAVILY_API_KEY:
    print("❌ 錯誤：請先設定 TAVILY_API_KEY 環境變數。搜尋功能將受限。")
    # exit(1) # 如果希望沒有金鑰就立即退出

try:
    if GOOGLE_API_KEY:
        genai.configure(api_key=GOOGLE_API_KEY)
        print("✅ Gemini API 金鑰已成功設定。")
    else:
        print("⚠️ 警告：Gemini API 金鑰未設定。部分功能可能無法使用。")

    if TAVILY_API_KEY:
        tavily_client = TavilyClient(api_key=TAVILY_API_KEY)
        print("✅ Tavily Search API 金鑰已成功設定。")
    else:
        print("⚠️ 警告：Tavily Search API 金鑰未設定。圖片和影片搜尋功能將受限。")

except Exception as e:
    print(f"❌ 初始化 API 金鑰時發生錯誤: {e}")
    traceback.print_exc()
    # 如果 API 初始化失敗，考慮是否讓程式退出
    # exit(1)

# --- 資料庫設定 ---
# 在打包後，DATABASE 路徑會相對於執行檔本身
DATABASE = 'database.db'

def get_db():
    """建立並回傳資料庫連線，使用 Row factory 可以用欄位名稱取得資料。"""
    # 這裡確保資料庫檔案會被創建在執行檔的同一個資料夾，或是使用者可寫入的目錄
    # 在 PyInstaller --onefile 模式下，工作目錄是執行檔所在的目錄
    db = sqlite3.connect(os.path.join(os.path.dirname(os.path.abspath(__file__)), DATABASE))
    db.row_factory = sqlite3.Row
    return db

def init_db():
    """初始化資料庫，若 recipes 資料表不存在就建立它。"""
    with app.app_context():
        db = get_db()
        cursor = db.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS recipes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                ingredients TEXT,
                steps TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        ''')
        db.commit()
        db.close()
        print("✅ 資料庫初始化完成。")

# 應用啟動時初始化資料庫
with app.app_context():
    init_db()

# --- 輔助函式 ---
def find_recipe_visuals(recipe_title):
    """透過 Tavily 搜尋食譜圖片與 YouTube 影片，回傳 (image_url, video_url)。"""
    # 設定一個預設圖片 URL，如果 Tavily 沒有找到圖片就使用它
    default_image_url = "/static/images/default_recipe_image.png" 
    image_url = default_image_url
    video_url = None # 預設影片 URL 為 None

    # 如果 Tavily API 金鑰沒有設定，則不執行搜尋
    if not TAVILY_API_KEY:
        print("⚠️ 警告：Tavily API 金鑰未設定，無法搜尋圖片和影片。")
        return default_image_url, None

    try:
        # 搜尋高清菜餚圖片
        image_search_results = tavily_client.search(
            query=f"'{recipe_title}' 菜餚圖片 高清",
            search_depth="basic", include_images=True
        )
        # 檢查是否有圖片結果，並使用第一張圖片
        if image_search_results and image_search_results.get("images") and image_search_results["images"]:
            image_url = image_search_results["images"][0]
            print(f"找到圖片 URL for {recipe_title}: {image_url}")
        else:
            print(f"Tavily 未找到 '{recipe_title}' 的圖片，使用預設圖片。")

        # 搜尋 YouTube 料理教學影片 (保持使用 Tavily 找到初步連結)
        video_search_results = tavily_client.search(
            query=f"YouTube '{recipe_title}' 料理教學影片 完整",
            search_depth="basic"
        )
        if video_search_results and video_search_results.get("results"):
            for result in video_search_results["results"]:
                tavily_found_url = result.get("url", "")
                
                # 檢查是否為 YouTube 相關連結，包括 googleusercontent.com 代理連結
                # 並嘗試提取影片 ID
                youtube_id_match = re.search(
                    r"(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|googleusercontent\.com\/youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})",
                    tavily_found_url
                )
                
                if youtube_id_match and youtube_id_match[1]:
                    video_id = youtube_id_match[1]
                    # 構建 YouTube 嵌入式 URL，使用 youtube-nocookie.com 以增強隱私，並添加 rel=0 禁用相關影片推薦
                    video_url = f"https://www.youtube-nocookie.com/embed/{video_id}?rel=0"
                    print(f"Tavily 找到並轉換影片 URL for {recipe_title}: {video_url}")
                    break # 找到有效影片，停止搜尋
            if not video_url:
                print(f"Tavily 未找到 '{recipe_title}' 的有效 YouTube 影片或無法提取 ID。")
        else:
            print(f"Tavily 影片搜尋無結果或格式錯誤。")

    except Exception as e:
        print(f"為 '{recipe_title}' 搜尋視覺資料時發生錯誤: {e}")
        traceback.print_exc()
        # 發生錯誤時，圖片使用預設，影片為 None
        image_url = default_image_url
        video_url = None
    return image_url, video_url

# --- API 端點 ---
@app.route('/')
def index():
    """回傳前端主頁面。"""
    # 這裡會渲染 templates 資料夾下的 index.html 檔案
    return render_template('index.html')

@app.route('/api/identify-ingredients', methods=['POST'])
def identify_ingredients_api():
    """上傳多張圖片，使用 Gemini 辨識食材，回傳 JSON 陣列。"""
    if not GOOGLE_API_KEY:
        return jsonify({"success": False, "error": "Gemini API 金鑰未設定，無法辨識圖片"}), 503

    if 'images' not in request.files:
        return jsonify({"success": False, "error": "沒有上傳圖片"}), 400
    image_files = request.files.getlist('images')
    if not image_files:
        return jsonify({"success": False, "error": "沒有上傳圖片"}), 400

    try:
        image_parts = []
        for file in image_files:
            try:
                img = Image.open(BytesIO(file.read()))
                image_parts.append(img)
            except Exception as e:
                print(f"Warning: 無法讀取圖片檔案 {file.filename}: {e}")
                continue

        if not image_parts:
            return jsonify({"success": False, "error": "上傳的圖片檔案無效或無法讀取"}), 400

        model = genai.GenerativeModel("gemini-1.5-flash")
        prompt_parts = [
            "分析這幾張冰箱或廚房的照片。請只辨識出主要、可食用且清晰可見的食材。忽略調味料小瓶、包裝文字和非食物品項。請以繁體中文回傳結果，並嚴格遵循以下 JSON 格式，只回傳一個 JSON 陣列，不要有任何多餘的文字或解釋。例如：[\"雞蛋\", \"牛奶\", \"青蔥\"]。如果看到多個相同的物品，只列出一次即可。優先考慮新鮮食材。",
            *image_parts,
        ]
        response = model.generate_content(prompt_parts)
        cleaned_response = response.text.strip().replace("```json", "").replace("```", "").strip()
        identified_items = json.loads(cleaned_response)
        return jsonify({"success": True, "ingredients": identified_items})
    except json.JSONDecodeError:
        traceback.print_exc()
        return jsonify({"success": False, "error": f"AI 回應格式錯誤，無法解析 JSON: {cleaned_response}"}), 500
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "error": f"圖片辨識失敗: {e}"}), 500

@app.route('/api/generate-recipes', methods=['POST'])
def generate_recipes_api():
    """根據辨識出的食材（與使用者補充的），使用 Gemini 生成三道台式創意料理，並回傳含圖片與影片鏈結。"""
    if not GOOGLE_API_KEY:
        return jsonify({"success": False, "error": "Gemini API 金鑰未設定，無法生成食譜"}), 503

    data = request.get_json()
    final_ingredients = data.get('ingredients')
    if not final_ingredients:
        return jsonify({"success": False, "error": "缺少食材"}), 400

    try:
        # 強制指定 MIME 類型為 JSON，避免模型誤判
        generation_config = { "response_mime_type": "application/json" }
        model = genai.GenerativeModel("gemini-1.5-flash", generation_config=generation_config)
        prompt = f"""
        你是一位充滿創意的台灣料理大師。請根據以下食材：{', '.join(final_ingredients)}，設計三道風格不同、美味且適合家庭的料理。難度應為簡單到中等。請嚴格按照以下 JSON 格式回傳，回傳一個包含 "recipes" 鍵的 JSON 物件，其值為一個包含三道食譜物件的陣列。
        每個食譜物件必須包含以下鍵：
        - "title": 食譜名稱。
        - "description": 簡短的食譜描述。
        - "prep_time": 準備時間（例如："15 分鐘"）。
        - "cook_time": 烹飪時間（例如："30 分鐘"）。
        - "servings": 建議份量（例如："4 人份"）。
        - "ingredients": 主要食材列表。
        - "seasonings": 調味料列表。
        - "steps": 料理步驟列表。
        - "chef_tip": 主廚小提示。
        - "calories": 這道菜的估計總熱量（例如："350 大卡"）。
        - "nutrition_info": 這道菜的主要營養成分概要（例如："蛋白質: 20克, 脂肪: 15克, 碳水化合物: 30克"）。
        """
        response = model.generate_content(prompt)
        recipes_data = json.loads(response.text)

        enriched_recipes = []
        for recipe in recipes_data.get('recipes', []):
            # 清理欄位，避免 None 或 undefined
            # 確保每個元素都是字串，並過濾掉 None
            recipe['ingredients'] = [str(item) for item in recipe.get('ingredients', []) if item is not None]
            recipe['seasonings'] = [str(item) for item in recipe.get('seasonings', []) if item is not None]
            recipe['description'] = str(recipe.get('description', ''))
            recipe['chef_tip'] = str(recipe.get('chef_tip', '享受您的料理吧！'))
            recipe['calories'] = str(recipe.get('calories', 'N/A'))
            recipe['nutrition_info'] = str(recipe.get('nutrition_info', 'N/A'))
            recipe['prep_time'] = str(recipe.get('prep_time', 'N/A')) # 確保這些時間欄位也處理
            recipe['cook_time'] = str(recipe.get('cook_time', 'N/A'))
            recipe['servings'] = str(recipe.get('servings', 'N/A'))
            recipe['steps'] = [str(item) for item in recipe.get('steps', []) if item is not None]

            # 找圖與影片
            image_url, video_url = find_recipe_visuals(recipe['title'])
            
            # 將圖片和影片 URL 賦值給食譜物件
            recipe['image_url'] = image_url
            recipe['video_url'] = video_url

            enriched_recipes.append(recipe)
            
            # 將生成的食譜儲存到資料庫
            db = get_db()
            # 將列表轉換為 JSON 字串儲存
            db.execute(
                'INSERT INTO recipes (title, ingredients, steps) VALUES (?, ?, ?)',
                (recipe['title'], json.dumps(recipe['ingredients'], ensure_ascii=False), json.dumps(recipe['steps'], ensure_ascii=False)) 
            )
            db.commit()
            db.close()

        return jsonify({"success": True, "recipes": enriched_recipes})
    except json.JSONDecodeError:
        traceback.print_exc()
        return jsonify({"success": False, "error": f"AI 回應格式錯誤，無法解析 JSON: {response.text}"}), 500
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "error": f"AI 處理失敗: {e}"}), 500

# 在新的執行緒中開啟瀏覽器
def open_browser():
    # 等待伺服器啟動，可以加一個小延遲確保伺服器準備好
    # 注意：這個延遲是估計值，在不同機器上可能需要調整
    import time
    time.sleep(1) 
    print("嘗試自動開啟瀏覽器...")
    webbrowser.open_new("http://127.0.0.1:5000/")

if __name__ == '__main__':
    print("正在啟動智慧料理助手伺服器...")
    # 在啟動 Flask 應用程式之前，在新執行緒中啟動瀏覽器
    # 確保自動開啟瀏覽器只在主應用程式啟動時執行一次
    # 並且只在不是在 PyInstaller 的 'onefile' 臨時目錄中運行時執行
    # (但為了簡化，在此直接添加，PyInstaller 會處理其運行環境)
    threading.Thread(target=open_browser).start()

    # 啟動 Flask 開發伺服器
    # 注意：debug=True 在生產環境下不建議使用，但在開發和單機應用測試中方便
    # 實際部署時應設為 False 或移除
    app.run(host='0.0.0.0', debug=False, port=5000) # 將 debug 設為 False