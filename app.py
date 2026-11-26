import csv
import io
import os
from datetime import date, datetime
from functools import wraps

from flask import Flask, Response, abort, flash, redirect, render_template, request, url_for
from flask_login import LoginManager, UserMixin, current_user, login_required, login_user, logout_user
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'change-this-secret-before-deployment')
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///hotel_orders.sqlite').replace('postgres://', 'postgresql://', 1)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    is_admin = db.Column(db.Boolean, default=False, nullable=False)
    orders = db.relationship('Order', backref='creator', cascade='all, delete-orphan')
    def set_password(self, value): self.password_hash = generate_password_hash(value)
    def check_password(self, value): return check_password_hash(self.password_hash, value)

class Order(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    order_no = db.Column(db.String(100), nullable=False)
    company = db.Column(db.String(160), default='')
    hotel = db.Column(db.String(200), default='')
    guest_name = db.Column(db.String(120), default='')
    order_time = db.Column(db.DateTime, default=datetime.now)
    checkin = db.Column(db.Date, nullable=True)
    checkout = db.Column(db.Date, nullable=True)
    nights = db.Column(db.Integer, default=0)
    days = db.Column(db.Integer, default=0)
    cost = db.Column(db.Float, default=0)
    quote = db.Column(db.Float, default=0)
    deposit = db.Column(db.Float, default=0)
    balance = db.Column(db.Float, default=0)
    profit = db.Column(db.Float, default=0)
    received = db.Column(db.Float, default=0)
    payment_method = db.Column(db.String(100), default='')
    stay_status = db.Column(db.String(20), default='待定')
    notes = db.Column(db.Text, default='')
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)

FIELDS = [('order_no','订单号'),('company','协议公司'),('hotel','酒店'),('guest_name','姓名'),('order_time','下单时间'),('checkin','入住日期'),('checkout','离店日期'),('nights','入住晚数'),('days','入住天数'),('cost','成本'),('quote','报价'),('deposit','定金'),('balance','尾款'),('profit','利润'),('received','回款'),('payment_method','付款方式'),('stay_status','是否成功入住'),('notes','备注')]

@login_manager.user_loader
def load_user(user_id): return db.session.get(User, int(user_id))

def admin_required(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        if not current_user.is_admin: abort(403)
        return fn(*args, **kwargs)
    return wrapped

def parse_date(value): return date.fromisoformat(value) if value else None
def parse_float(value): return float(value or 0)

@app.route('/login', methods=['GET','POST'])
def login():
    if current_user.is_authenticated: return redirect(url_for('orders'))
    if request.method == 'POST':
        user = User.query.filter_by(username=request.form.get('username','').strip()).first()
        if user and user.check_password(request.form.get('password','')):
            login_user(user); return redirect(url_for('orders'))
        flash('用户名或密码错误。','danger')
    return render_template('login.html')

@app.get('/logout')
@login_required
def logout(): logout_user(); return redirect(url_for('login'))

@app.route('/')
@login_required
def orders():
    q = Order.query if current_user.is_admin else Order.query.filter_by(user_id=current_user.id)
    term = request.args.get('q','').strip()
    status = request.args.get('status','')
    if term: q = q.filter(db.or_(Order.order_no.contains(term), Order.hotel.contains(term), Order.guest_name.contains(term), Order.company.contains(term)))
    if status: q = q.filter_by(stay_status=status)
    pagination = q.order_by(Order.order_time.desc()).paginate(page=request.args.get('page',1,type=int), per_page=10, error_out=False)
    return render_template('orders.html', pagination=pagination, fields=FIELDS, q=term, status=status)

@app.route('/order/new', methods=['GET','POST'])
@app.route('/order/<int:order_id>/edit', methods=['GET','POST'])
@login_required
def order_form(order_id=None):
    order = db.session.get(Order, order_id) if order_id else Order()
    if order_id and (order is None or (not current_user.is_admin and order.user_id != current_user.id)): abort(404)
    if request.method == 'POST':
        order.order_no = request.form.get('order_no','').strip()
        if not order.order_no: flash('订单号为必填项。','danger'); return render_template('order_form.html', order=order, fields=FIELDS)
        for attr in ['company','hotel','guest_name','payment_method','stay_status','notes']: setattr(order, attr, request.form.get(attr,''))
        order.checkin, order.checkout = parse_date(request.form.get('checkin')), parse_date(request.form.get('checkout'))
        order.order_time = datetime.fromisoformat(request.form['order_time']) if request.form.get('order_time') else datetime.now()
        order.nights = max(0,(order.checkout-order.checkin).days) if order.checkin and order.checkout else 0
        order.days = order.nights + 1 if order.nights else 0
        for attr in ['cost','quote','deposit','balance','received']: setattr(order,attr,parse_float(request.form.get(attr)))
        order.profit = order.quote - order.cost
        if not order_id: order.user_id = current_user.id; db.session.add(order)
        db.session.commit(); flash('订单已保存。','success'); return redirect(url_for('orders'))
    return render_template('order_form.html', order=order, fields=FIELDS)

@app.post('/order/<int:order_id>/delete')
@login_required
def delete_order(order_id):
    order=db.session.get(Order,order_id)
    if not order or (not current_user.is_admin and order.user_id != current_user.id): abort(404)
    db.session.delete(order); db.session.commit(); flash('订单已删除。','success'); return redirect(url_for('orders'))

@app.get('/export.csv')
@login_required
def export_csv():
    q=Order.query if current_user.is_admin else Order.query.filter_by(user_id=current_user.id)
    term=request.args.get('q','').strip(); status=request.args.get('status','')
    if term: q=q.filter(db.or_(Order.order_no.contains(term),Order.hotel.contains(term),Order.guest_name.contains(term),Order.company.contains(term)))
    if status: q=q.filter_by(stay_status=status)
    out=io.StringIO(); writer=csv.writer(out); writer.writerow([label for _,label in FIELDS]+(['录入员工'] if current_user.is_admin else []))
    for o in q.order_by(Order.order_time.desc()):
        writer.writerow([getattr(o,key) for key,_ in FIELDS]+([o.creator.username] if current_user.is_admin else []))
    return Response('\ufeff'+out.getvalue(), mimetype='text/csv; charset=utf-8', headers={'Content-Disposition':'attachment; filename=hotel_orders.csv'})

@app.route('/admin/users', methods=['GET','POST'])
@login_required
@admin_required
def users():
    if request.method=='POST':
        username=request.form.get('username','').strip(); password=request.form.get('password','')
        if not username or len(password)<6: flash('用户名必填，密码至少 6 位。','danger')
        elif User.query.filter_by(username=username).first(): flash('该用户名已存在。','danger')
        else:
            user=User(username=username); user.set_password(password); db.session.add(user); db.session.commit(); flash('员工账号已创建。','success')
    return render_template('users.html', users=User.query.order_by(User.id).all())

@app.post('/admin/users/<int:user_id>/delete')
@login_required
@admin_required
def delete_user(user_id):
    user=db.session.get(User,user_id)
    if not user or user.is_admin: abort(404)
    db.session.delete(user); db.session.commit(); flash('员工及其订单已删除。','success'); return redirect(url_for('users'))

with app.app_context():
    db.create_all()
    if not User.query.filter_by(username='admin').first():
        admin=User(username='admin',is_admin=True); admin.set_password(os.getenv('ADMIN_PASSWORD','123456')); db.session.add(admin); db.session.commit()

if __name__ == '__main__': app.run(host='127.0.0.1',port=int(os.getenv('PORT',5000)),debug=False)
